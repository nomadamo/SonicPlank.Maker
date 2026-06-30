#![allow(unsafe_code)]

use std::sync::{Arc, Mutex};
use std::collections::HashMap;

use sonicplank_ipc::{BlurRegionDef, StreamSourceDef};
use crate::capture::{RawFrame, ShmOverlay, SharedShmOverlay};
use ffmpeg_sys_next::*;

pub struct CompositeFrame {
    pub primary: Arc<RawFrame>,
    pub pips: Vec<(StreamSourceDef, Arc<RawFrame>)>,
}

pub struct CompositorConfig {
    pub sources: Vec<StreamSourceDef>,
    pub blur_regions: Vec<BlurRegionDef>,
}

pub type SharedCompositorConfig = Arc<Mutex<CompositorConfig>>;

fn bgra_blend(
    src: &[u8], src_w: i32, src_h: i32,
    dst: &mut [u8], dst_w: i32, dst_h: i32,
    offset_x: i32, offset_y: i32,
) {
    for r in 0..src_h {
        let y = offset_y + r;
        if y < 0 || y >= dst_h { continue; }

        for c in 0..src_w {
            let x = offset_x + c;
            if x < 0 || x >= dst_w { continue; }

            let src_idx = ((r * src_w + c) * 4) as usize;
            let dst_idx = ((y * dst_w + x) * 4) as usize;

            let sa = src[src_idx + 3] as u32;
            if sa == 0 { continue; }

            if sa == 255 {
                dst[dst_idx] = src[src_idx];
                dst[dst_idx + 1] = src[src_idx + 1];
                dst[dst_idx + 2] = src[src_idx + 2];
                dst[dst_idx + 3] = 255;
                continue;
            }

            let sr = src[src_idx + 2] as u32;
            let sg = src[src_idx + 1] as u32;
            let sb = src[src_idx] as u32;

            let dr = dst[dst_idx + 2] as u32;
            let dg = dst[dst_idx + 1] as u32;
            let db = dst[dst_idx] as u32;
            let da = dst[dst_idx + 3] as u32;

            let inv_sa = 255 - sa;

            let out_a = sa + (da * inv_sa) / 255;
            if out_a == 0 { continue; }

            let out_r = (sr * 255 + dr * inv_sa) / 255;
            let out_g = (sg * 255 + dg * inv_sa) / 255;
            let out_b = (sb * 255 + db * inv_sa) / 255;

            dst[dst_idx] = (out_b.min(255)) as u8;
            dst[dst_idx + 1] = (out_g.min(255)) as u8;
            dst[dst_idx + 2] = (out_r.min(255)) as u8;
            dst[dst_idx + 3] = out_a as u8;
        }
    }
}

// Apply a SIMD-accelerated stack blur (via libblur) to a rectangular region of a
// BGRA frame in-place. Region coordinates are clamped to frame bounds.
fn apply_blur_region(pixels: &mut [u8], fw: i32, fh: i32, region: &BlurRegionDef) {
    use libblur::{AnisotropicRadius, BlurImageMut, BufferStore, FastBlurChannels, ThreadingPolicy};

    let x0 = region.x.max(0);
    let y0 = region.y.max(0);
    let x1 = (region.x + region.w).min(fw);
    let y1 = (region.y + region.h).min(fh);
    let w = x1 - x0;
    let h = y1 - y0;
    if w <= 0 || h <= 0 || region.radius <= 0 { return; }

    // Extract sub-region to a compact flat buffer (row-major BGRA)
    let n = (w * h * 4) as usize;
    let mut sub = vec![0u8; n];
    for y in 0..h {
        for x in 0..w {
            let fi = ((y0 + y) * fw + (x0 + x)) as usize * 4;
            let ri = (y * w + x) as usize * 4;
            sub[ri..ri + 4].copy_from_slice(&pixels[fi..fi + 4]);
        }
    }

    let mut image = BlurImageMut {
        data: BufferStore::Borrowed(&mut sub),
        width: w as u32,
        height: h as u32,
        stride: (w * 4) as u32,
        channels: FastBlurChannels::Channels4,
    };
    let _ = libblur::stack_blur(
        &mut image,
        AnisotropicRadius::new(region.radius as u32),
        ThreadingPolicy::Adaptive,
    );

    // Write blurred sub-region back into the frame
    for y in 0..h {
        for x in 0..w {
            let fi = ((y0 + y) * fw + (x0 + x)) as usize * 4;
            let ri = (y * w + x) as usize * 4;
            pixels[fi..fi + 4].copy_from_slice(&sub[ri..ri + 4]);
        }
    }
}

/// Try to copy a consistent overlay frame from the SHM region via seqlock.
/// Returns `Some((width, height))` if a valid frame was copied into `buf`.
/// `buf` is pre-allocated and reused across frames to avoid per-frame allocation.
unsafe fn read_shm_overlay(shm: &ShmOverlay, buf: &mut Vec<u8>) -> Option<(u32, u32)> {
    use std::sync::atomic::{AtomicU32, Ordering, fence};

    let base = shm.view;
    if base.is_null() || shm.size < 12 {
        return None;
    }

    let gen_ptr = base as *const AtomicU32;

    // Up to 16 attempts: spin through both "write in progress" (odd gen) and
    // torn-copy races (gen changed between read and re-check).
    for _ in 0..16 {
        let gen1 = (*gen_ptr).load(Ordering::Acquire);
        if gen1 == 0 {
            // No frame written yet.
            return None;
        }
        if gen1 & 1 == 1 {
            // Electron write in progress — spin and retry rather than bail.
            // The write window is ~10–50 µs (two koffi memcpy calls); a few
            // spin iterations are enough to outlast it on any modern CPU.
            std::hint::spin_loop();
            continue;
        }

        let ov_w = std::ptr::read_volatile(base.add(4) as *const u32);
        let ov_h = std::ptr::read_volatile(base.add(8) as *const u32);

        if ov_w == 0 || ov_h == 0 {
            return None;
        }

        let px_len = (ov_w as usize).saturating_mul(ov_h as usize).saturating_mul(4);
        if 12 + px_len > shm.size {
            return None;
        }

        // Copy pixels into the reusable buffer.
        buf.resize(px_len, 0);
        std::ptr::copy_nonoverlapping(base.add(12), buf.as_mut_ptr(), px_len);

        // Acquire fence ensures the copy is complete before we re-read gen.
        fence(Ordering::Acquire);
        let gen2 = (*gen_ptr).load(Ordering::Acquire);

        if gen2 == gen1 {
            // Copy was consistent.
            return Some((ov_w, ov_h));
        }
        // gen changed mid-copy (torn read) — retry.
    }

    None
}

pub fn composite_frame(
    raw: &CompositeFrame,
    shm_overlay: &ShmOverlay,
    blur_regions: &[BlurRegionDef],
    pip_scalers: &mut HashMap<String, (*mut SwsContext, i32, i32, i32, i32)>,
    overlay_buf: &mut Vec<u8>,
    good_overlay_buf: &mut Vec<u8>,
    last_overlay_dims: &mut Option<(u32, u32)>,
) -> Arc<RawFrame> {
    let out_w = raw.primary.width as i32;
    let out_h = raw.primary.height as i32;

    let mut out_pixels = raw.primary.pixels.clone();

    for (def, pip_raw) in &raw.pips {
        let pw = (def.w_percent / 100.0 * out_w as f32).round() as i32 & !1;
        let ph = (def.h_percent / 100.0 * out_h as f32).round() as i32 & !1;
        let px = (def.x_percent / 100.0 * out_w as f32).round() as i32 & !1;
        let py = (def.y_percent / 100.0 * out_h as f32).round() as i32 & !1;

        if pw <= 0 || ph <= 0 { continue; }

        let src_w = pip_raw.width as i32;
        let src_h = pip_raw.height as i32;

        let cached = pip_scalers.get(&def.source_id);
        let need_new = match cached {
            Some((_, cw, ch, dw, dh)) => *cw != src_w || *ch != src_h || *dw != pw || *dh != ph,
            None => true,
        };

        if need_new {
            if let Some((ctx, _, _, _, _)) = pip_scalers.remove(&def.source_id) {
                unsafe { sws_freeContext(ctx); }
            }
            let ctx = unsafe {
                sws_getContext(
                    src_w, src_h, AVPixelFormat::AV_PIX_FMT_BGRA,
                    pw, ph, AVPixelFormat::AV_PIX_FMT_BGRA,
                    SwsFlags::SWS_BILINEAR as i32, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null()
                )
            };
            pip_scalers.insert(def.source_id.clone(), (ctx, src_w, src_h, pw, ph));
        }

        let sws = pip_scalers.get(&def.source_id).unwrap().0;

        let mut scaled_pip = vec![0u8; (pw * ph * 4) as usize];

        let src_data: [*const u8; 4] = [pip_raw.pixels.as_ptr(), std::ptr::null(), std::ptr::null(), std::ptr::null()];
        let src_stride: [i32; 4] = [src_w * 4, 0, 0, 0];
        let mut dst_data: [*mut u8; 4] = [scaled_pip.as_mut_ptr(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()];
        let dst_stride: [i32; 4] = [pw * 4, 0, 0, 0];

        unsafe {
            sws_scale(
                sws,
                src_data.as_ptr(),
                src_stride.as_ptr(),
                0, src_h,
                dst_data.as_mut_ptr(),
                dst_stride.as_ptr(),
            );
        }

        bgra_blend(&scaled_pip, pw, ph, &mut out_pixels, out_w, out_h, px, py);
    }

    // Apply blur regions to the composited video frame before overlays are blended in.
    // This blurs the capture (+ PIPs) while keeping overlay elements sharp on top.
    for region in blur_regions {
        apply_blur_region(&mut out_pixels, out_w, out_h, region);
    }

    // Read the overlay from shared memory via seqlock.
    let overlay_dims = unsafe { read_shm_overlay(shm_overlay, overlay_buf) };
    if let Some(dims) = overlay_dims {
        // Consistent read — promote to last-known-good by swapping buffers (O(1), no copy).
        // After swap: good_overlay_buf has fresh pixels; overlay_buf holds stale data
        // that will be overwritten on the next frame's seqlock read.
        std::mem::swap(overlay_buf, good_overlay_buf);
        *last_overlay_dims = Some(dims);
    }

    // Always composite from the last-known-good buffer.
    // On any seqlock-race frame the previous overlay is reused instead of disappearing.
    if let Some((ov_w, ov_h)) = *last_overlay_dims {
        let px_len = ov_w as usize * ov_h as usize * 4;
        if good_overlay_buf.len() >= px_len {
            bgra_blend(&good_overlay_buf[..px_len], ov_w as i32, ov_h as i32, &mut out_pixels, out_w, out_h, 0, 0);
        }
    }

    Arc::new(RawFrame {
        source_id: "preview".to_string(),
        width: raw.primary.width,
        height: raw.primary.height,
        pixels: out_pixels,
        // Inherit the primary frame's WGC timestamp so the encoder's
        // jitter buffer can still select by temporal proximity.
        timestamp_100ns: raw.primary.timestamp_100ns,
    })
}

pub fn start_compositor(
    mut frame_rx: tokio::sync::broadcast::Receiver<Arc<RawFrame>>,
    shm_overlay: SharedShmOverlay,
    config: SharedCompositorConfig,
) -> tokio::sync::broadcast::Sender<Arc<RawFrame>> {
    let (tx, _rx) = tokio::sync::broadcast::channel(8);
    let out_tx = tx.clone();

    std::thread::spawn(move || {
        let mut latest_pips: HashMap<String, Arc<RawFrame>> = HashMap::new();
        let mut pip_scalers: HashMap<String, (*mut SwsContext, i32, i32, i32, i32)> = HashMap::new();
        // Reusable buffers for seqlock overlay copies — allocated once, avoids per-frame 8 MB allocs.
        // overlay_buf: staging target for each seqlock read attempt.
        // good_overlay_buf: last confirmed-consistent frame; used as fallback on race failures.
        let mut overlay_buf: Vec<u8> = Vec::with_capacity(1920 * 1080 * 4);
        let mut good_overlay_buf: Vec<u8> = Vec::with_capacity(1920 * 1080 * 4);
        let mut last_overlay_dims: Option<(u32, u32)> = None;

        let mut rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async move {
            loop {
                match frame_rx.recv().await {
                    Ok(frame) => {
                        let cfg = config.lock().unwrap();
                        let primary_source_id = cfg.sources.iter().find(|s| s.is_primary).map(|s| s.source_id.clone());
                        let pip_defs: Vec<StreamSourceDef> = cfg.sources.iter().filter(|s| !s.is_primary).cloned().collect();

                        let sid = &frame.source_id;
                        if Some(sid.clone()) == primary_source_id {
                            let mut current_pips = Vec::new();
                            for def in &pip_defs {
                                if let Some(pip_frame) = latest_pips.get(&def.source_id) {
                                    current_pips.push((def.clone(), Arc::clone(pip_frame)));
                                }
                            }
                            let composite = CompositeFrame {
                                primary: frame,
                                pips: current_pips,
                            };

                            let blur = cfg.blur_regions.clone();
                            drop(cfg);
                            let out_frame = composite_frame(&composite, &shm_overlay, &blur, &mut pip_scalers, &mut overlay_buf, &mut good_overlay_buf, &mut last_overlay_dims);
                            let _ = tx.send(out_frame);
                        } else {
                            latest_pips.insert(sid.clone(), frame);
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::trace!("compositor missed {n} broadcast frames (lagged)");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        break;
                    }
                }
            }
        });
    });

    out_tx
}
