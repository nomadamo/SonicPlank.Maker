#![allow(unsafe_code)]

use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use windows::{
    Foundation::TypedEventHandler,
    Graphics::{
        Capture::{
            Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem,
            GraphicsCaptureSession,
        },
        DirectX::{
            Direct3D11::{IDirect3DDevice, IDirect3DSurface},
            DirectXPixelFormat,
        },
    },
    Win32::{
        Foundation::HMODULE,
        Graphics::{
            Direct2D::ID2D1Bitmap1,
            Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            Direct3D11::{
                D3D11CreateDevice, D3D11_CPU_ACCESS_READ,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
                D3D11_USAGE_STAGING, ID3D11Device, ID3D11DeviceContext,
                ID3D11Texture2D,
            },
            Dxgi::{
                Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC},
                IDXGIDevice,
            },
        },
        System::WinRT::Direct3D11::{
            CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
        },
    },
    core::{IInspectable, Interface},
};

/// Shared channel for overlay BGRA frames arriving from the offscreen BrowserWindow.
/// JS writes type-2 frames to the data pipe; `run_data_pipe` stores them here;
/// `process_frame` picks them up and uploads to D2D on the next WGC callback.
pub type SharedOverlay = Arc<Mutex<Option<(Vec<u8>, u32, u32)>>>;

/// Raw BGRA video frame from WGC. Shared between the preview pipe writer and
/// the stream encoder via `Arc` to avoid copies.
pub struct RawFrame {
    pub source_id: String,
    pub width: u32,
    pub height: u32,
    /// BGRA pixels, row-major, `width * height * 4` bytes.
    pub pixels: Vec<u8>,
}

// ── GPU state shared across frames ───────────────────────────────────────────

struct GpuState {
    ctx:       ID3D11DeviceContext,
    staging:   ID3D11Texture2D,
    staging_w: u32,
    staging_h: u32,
}

// Safety: D3D11/D2D objects are COM interface pointers. All access is
// serialized through the Mutex so there are no concurrent accesses.
unsafe impl Send for GpuState {}
unsafe impl Sync for GpuState {}

/// Active WGC capture session. Drop or call [`stop`] to release all resources.
pub struct CaptureSession {
    _session: GraphicsCaptureSession,
    _pool: Direct3D11CaptureFramePool,
}

impl CaptureSession {
    /// Start capturing `item`. Each decoded BGRA frame is broadcast on `tx`.
    /// `shared_overlay` is polled each frame for fresh pixels from the offscreen
    /// overlay BrowserWindow — no WGC session for the overlay is needed.
    pub fn new(
        source_id: String,
        item: GraphicsCaptureItem,
        tx: tokio::sync::broadcast::Sender<Arc<RawFrame>>,
    ) -> Result<Self> {
        let (device, context) = create_d3d11_device()?;
        let d3d_device = wrap_as_direct3d_device(&device)?;

        let size = item.Size().context("Failed to read capture item size")?;
        let init_w = size.Width as u32;
        let init_h = size.Height as u32;

        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &d3d_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )
        .context("Failed to create Direct3D11CaptureFramePool")?;

        let session = pool
            .CreateCaptureSession(&item)
            .context("Failed to create GraphicsCaptureSession")?;

        let init_staging = create_staging_texture(&device, init_w, init_h)?;

        let device_arc = Arc::new(device.clone());
        let gpu_arc = Arc::new(Mutex::new(GpuState {
            ctx:          context,
            staging:      init_staging,
            staging_w:    init_w,
            staging_h:    init_h,
        }));

        let frame_count = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let gpu_arc_main = gpu_arc.clone();

        pool.FrameArrived(
            &TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(
                move |pool, _| {
                    let pool = match pool.as_ref() {
                        Some(p) => p,
                        None => return Ok(()),
                    };

                    let frame = match pool.TryGetNextFrame() {
                        Ok(f) => f,
                        Err(e) => {
                            tracing::debug!("Failed to get next frame (pool might be closed): {e}");
                            return Ok(());
                        }
                    };

                    let n = frame_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    if n == 0 {
                        tracing::info!("First frame arrived from WGC");
                    }

                    match process_frame(&device_arc, &gpu_arc_main, &frame, &source_id) {
                        Ok(raw) => {
                            let _ = tx.send(Arc::new(raw));
                        }
                        Err(e) => tracing::warn!("process_frame error: {e:#}"),
                    }
                    Ok(())
                },
            ),
        )
        .context("Failed to register FrameArrived handler")?;

        session.StartCapture().context("StartCapture failed")?;

        Ok(Self { _session: session, _pool: pool })
    }

    pub fn stop(&mut self) -> Result<()> {
        self._session.Close().context("Failed to close GraphicsCaptureSession")?;
        self._pool.Close().context("Failed to close Direct3D11CaptureFramePool")?;
        Ok(())
    }
}

// ── D3D11 helpers ─────────────────────────────────────────────────────────────

fn create_d3d11_device() -> Result<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;

    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
        .context("D3D11CreateDevice failed")?;
    }

    Ok((device.context("D3D11 device was None")?, context.context("D3D11 context was None")?))
}

fn wrap_as_direct3d_device(device: &ID3D11Device) -> Result<IDirect3DDevice> {
    let dxgi_device: IDXGIDevice =
        device.cast().context("ID3D11Device → IDXGIDevice cast failed")?;
    let inspectable = unsafe {
        CreateDirect3D11DeviceFromDXGIDevice(Some(&dxgi_device))
            .context("CreateDirect3D11DeviceFromDXGIDevice failed")?
    };
    inspectable.cast().context("IInspectable → IDirect3DDevice cast failed")
}

fn create_staging_texture(device: &ID3D11Device, width: u32, height: u32) -> Result<ID3D11Texture2D> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width:     width,
        Height:    height,
        MipLevels: 1,
        ArraySize: 1,
        Format:    DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage:     D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut out: Option<ID3D11Texture2D> = None;
    unsafe {
        device
            .CreateTexture2D(&desc, None, Some(&mut out))
            .context("CreateTexture2D (staging) failed")?;
    }
    out.context("Staging texture was None after creation")
}

// ── Per-frame processing ───────────────────────────────────────────────────────

fn process_frame(
    device: &ID3D11Device,
    gpu: &Mutex<GpuState>,
    frame: &Direct3D11CaptureFrame,
    source_id: &str,
) -> Result<RawFrame> {
    let surface: IDirect3DSurface = frame.Surface().context("Frame had no surface")?;
    let dxgi_access: IDirect3DDxgiInterfaceAccess = surface
        .cast()
        .context("IDirect3DSurface → IDirect3DDxgiInterfaceAccess cast failed")?;
    let texture: ID3D11Texture2D =
        unsafe { dxgi_access.GetInterface() }.context("GetInterface<ID3D11Texture2D> failed")?;

    let mut src_desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { texture.GetDesc(&mut src_desc) };
    let width  = src_desc.Width;
    let height = src_desc.Height;

    let mut gpu = gpu.lock().unwrap();

    // Recreate staging texture only if display dimensions changed.
    if gpu.staging_w != width || gpu.staging_h != height {
        tracing::info!("Capture dimensions changed to {width}×{height} — recreating staging texture");
        gpu.staging   = create_staging_texture(device, width, height)?;
        gpu.staging_w = width;
        gpu.staging_h = height;
    }

    let stride = width as usize * 4;
    let mut pixels: Vec<u8> = vec![0u8; height as usize * stride];

    unsafe {
        gpu.ctx.CopyResource(&gpu.staging, &texture);

        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        gpu.ctx
            .Map(&gpu.staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            .context("Map staging texture failed")?;

        let row_pitch = mapped.RowPitch as usize;
        let src_base  = mapped.pData.cast::<u8>();
        for row in 0..height as usize {
            let src_row = src_base.add(row * row_pitch);
            pixels[row * stride..][..stride]
                .copy_from_slice(std::slice::from_raw_parts(src_row, stride));
        }

        gpu.ctx.Unmap(&gpu.staging, 0);
    }

    Ok(RawFrame { source_id: source_id.to_string(), width, height, pixels })
}
