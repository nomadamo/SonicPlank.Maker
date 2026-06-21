use std::sync::{Arc, Mutex};
use std::collections::HashMap;

use sonicplank_ipc::StreamSourceDef;
use crate::capture::{RawFrame, SharedOverlay};
use ffmpeg_sys_next::*;

pub struct CompositeFrame {
    pub primary: Arc<RawFrame>,
    pub pips: Vec<(StreamSourceDef, Arc<RawFrame>)>,
}

pub struct CompositorConfig {
    pub sources: Vec<StreamSourceDef>,
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

pub fn composite_frame(
    raw: &CompositeFrame,
    shared_overlay: &SharedOverlay,
    pip_scalers: &mut HashMap<String, (*mut SwsContext, i32, i32, i32, i32)>,
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
                    SWS_BILINEAR as i32, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null()
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

    if let Some((ov_pixels, ov_w, ov_h)) = shared_overlay.lock().unwrap().as_ref() {
        if *ov_w > 0 && *ov_h > 0 {
            bgra_blend(ov_pixels, *ov_w as i32, *ov_h as i32, &mut out_pixels, out_w, out_h, 0, 0);
        }
    }

    Arc::new(RawFrame {
        source_id: "preview".to_string(),
        width: raw.primary.width,
        height: raw.primary.height,
        pixels: out_pixels,
    })
}

pub fn start_compositor(
    mut frame_rx: tokio::sync::broadcast::Receiver<Arc<RawFrame>>,
    shared_overlay: SharedOverlay,
    config: SharedCompositorConfig,
) -> tokio::sync::broadcast::Sender<Arc<RawFrame>> {
    let (tx, _rx) = tokio::sync::broadcast::channel(8);
    let out_tx = tx.clone();
    
    std::thread::spawn(move || {
        let mut latest_pips: HashMap<String, Arc<RawFrame>> = HashMap::new();
        let mut pip_scalers: HashMap<String, (*mut SwsContext, i32, i32, i32, i32)> = HashMap::new();

        // Use blocking recv in the thread
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
                            
                            let out_frame = composite_frame(&composite, &shared_overlay, &mut pip_scalers);
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
