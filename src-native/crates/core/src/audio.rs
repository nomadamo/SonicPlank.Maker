#![allow(unsafe_code)]
//! Audio capture for streaming.
//!
//! - `input:` prefix  → CPAL (microphone / physical input device)
//! - `output:` prefix → WASAPI loopback (Voicemeeter, speakers, virtual cables)
//!
//! Both paths produce f32 PCM into the same `ringbuf::HeapRb<f32>` consumed
//! by the AAC encoder. The caller does not need to know which path was taken.

use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::{traits::{Producer, Consumer, Split}, HeapRb};
use sonicplank_ipc::AudioDeviceDef;

// ── Device enumeration ─────────────────────────────────────────────────────

pub fn get_audio_devices() -> Result<Vec<AudioDeviceDef>> {
    let host = cpal::default_host();
    let mut devices = Vec::new();

    let default_input  = host.default_input_device().map(|d| d.name().unwrap_or_default());
    let default_output = host.default_output_device().map(|d| d.name().unwrap_or_default());

    if let Ok(input_devices) = host.input_devices() {
        for device in input_devices {
            if let Ok(name) = device.name() {
                let is_default = default_input.as_ref() == Some(&name);
                devices.push(AudioDeviceDef {
                    id: format!("input:{name}"),
                    name: name.clone(),
                    is_input: true,
                    is_default,
                });
            }
        }
    }

    // Enumerate render (output) endpoints for WASAPI loopback.
    if let Ok(output_devices) = host.output_devices() {
        for device in output_devices {
            if let Ok(name) = device.name() {
                let is_default = default_output.as_ref() == Some(&name);
                devices.push(AudioDeviceDef {
                    id: format!("output:{name}"),
                    name: name.clone(),
                    is_input: false,
                    is_default,
                });
            }
        }
    }

    Ok(devices)
}

// ── Unified capture entry point ────────────────────────────────────────────

pub fn start_audio_capture(
    device_id: &str,
) -> Result<(ActiveStream, ringbuf::HeapCons<f32>, cpal::StreamConfig)> {
    if let Some(name) = device_id.strip_prefix("output:") {
        start_wasapi_loopback(name)
    } else if let Some(name) = device_id.strip_prefix("input:") {
        start_cpal_input(name)
    } else {
        // Legacy bare id: try loopback first, then input.
        start_wasapi_loopback(device_id)
            .or_else(|_| start_cpal_input(device_id))
    }
}

// ── Stream handle ──────────────────────────────────────────────────────────

pub enum ActiveStream {
    Cpal(cpal::Stream),
    /// Drop this sender to signal the WASAPI loopback thread to stop.
    Wasapi(std::sync::mpsc::SyncSender<()>),
}

// Safety: cpal::Stream is not Send; we hold it only for its Drop lifetime.
#[allow(clippy::non_send_fields_in_send_ty)]
unsafe impl Send for ActiveStream {}

impl Drop for ActiveStream {
    fn drop(&mut self) {
        if let ActiveStream::Wasapi(tx) = self {
            let _ = tx.try_send(());
        }
    }
}

// ── CPAL input path (microphones / physical inputs) ───────────────────────

fn start_cpal_input(
    name: &str,
) -> Result<(ActiveStream, ringbuf::HeapCons<f32>, cpal::StreamConfig)> {
    let host = cpal::default_host();

    let device = if name.is_empty() {
        host.default_input_device()
            .ok_or_else(|| anyhow!("No default input device"))?
    } else {
        host.input_devices()?
            .find(|x| x.name().unwrap_or_default() == name)
            .ok_or_else(|| anyhow!("Input device '{name}' not found"))?
    };

    let config = device.default_input_config()?;
    let sample_format = config.sample_format();
    let config: cpal::StreamConfig = config.into();

    let rb = HeapRb::<f32>::new(config.sample_rate.0 as usize * 4);
    let (mut prod, cons) = rb.split();
    let err_fn = |err| tracing::error!("CPAL input error: {}", err);

    let stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _: &_| { prod.push_slice(data); },
            err_fn, None,
        )?,
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _: &_| {
                for &s in data { let _ = prod.try_push(s as f32 / i16::MAX as f32); }
            },
            err_fn, None,
        )?,
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], _: &_| {
                for &s in data {
                    let _ = prod.try_push(
                        (s as f32 - u16::MAX as f32 / 2.0) / (u16::MAX as f32 / 2.0)
                    );
                }
            },
            err_fn, None,
        )?,
        _ => return Err(anyhow!("Unsupported sample format")),
    };

    stream.play()?;
    Ok((ActiveStream::Cpal(stream), cons, config))
}

// ── WASAPI loopback path (Voicemeeter / speakers / virtual cables) ─────────

fn start_wasapi_loopback(
    name: &str,
) -> Result<(ActiveStream, ringbuf::HeapCons<f32>, cpal::StreamConfig)> {
    // Use CPAL to resolve sample_rate + channels for the device.
    let host = cpal::default_host();
    let device = if name.is_empty() {
        host.default_output_device()
            .ok_or_else(|| anyhow!("No default output device"))?
    } else {
        host.output_devices()?
            .find(|x| x.name().unwrap_or_default() == name)
            .ok_or_else(|| anyhow!("Output device '{name}' not found — is Voicemeeter running?"))?
    };

    let out_cfg     = device.default_output_config()?;
    let sample_rate = out_cfg.sample_rate().0;
    let channels    = out_cfg.channels() as u32;

    let stream_config = cpal::StreamConfig {
        channels:    channels as u16,
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Default,
    };

    let rb = HeapRb::<f32>::new(sample_rate as usize * channels as usize * 4);
    let (mut prod, cons) = rb.split();

    let (stop_tx, stop_rx) = std::sync::mpsc::sync_channel::<()>(1);
    let dev_name = name.to_owned();

    std::thread::Builder::new()
        .name("wasapi-loopback".into())
        .spawn(move || {
            // Safety: WASAPI COM calls are all wrapped in this dedicated thread.
            let result = unsafe {
                wasapi_loopback_thread(&dev_name, sample_rate, channels, &mut prod, stop_rx)
            };
            if let Err(e) = result {
                tracing::error!("WASAPI loopback thread error: {e}");
            }
        })
        .map_err(|e| anyhow!("Failed to spawn WASAPI loopback thread: {e}"))?;

    Ok((ActiveStream::Wasapi(stop_tx), cons, stream_config))
}

// ── WASAPI loopback thread implementation ─────────────────────────────────

unsafe fn wasapi_loopback_thread(
    dev_name: &str,
    sample_rate: u32,
    channels: u32,
    prod: &mut ringbuf::HeapProd<f32>,
    stop_rx: std::sync::mpsc::Receiver<()>,
) -> Result<()> {
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::{
        eConsole, eRender,
        IAudioCaptureClient, IAudioClient,
        IMMDeviceEnumerator, MMDeviceEnumerator,
        AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
        DEVICE_STATE_ACTIVE, WAVEFORMATEX,
    };
    use windows::Win32::Media::Multimedia::WAVE_FORMAT_IEEE_FLOAT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
    };
    use windows::Win32::System::Com::StructuredStorage::PropVariantClear;
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::core::GUID;

    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;

    // Find the render endpoint matching dev_name, or fall back to default.
    let mm_device = if dev_name.is_empty() {
        enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?
    } else {
        let collection = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        let count = collection.GetCount().unwrap_or(0);

        // PKEY_Device_FriendlyName = {a45c254e-df1c-4efd-8020-67d146a850e0}, pid=14
        let pkey = PROPERTYKEY {
            fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
            pid: 14,
        };

        let mut found = None;
        for i in 0..count {
            if let Ok(dev) = collection.Item(i) {
                if let Ok(ps) = dev.OpenPropertyStore(STGM_READ) {
                    // GetValue returns PROPVARIANT directly in windows 0.61
                    if let Ok(mut pv) = ps.GetValue(&pkey) {
                        // vt == VT_LPWSTR (31) — device friendly name is a wide string ptr
                        if pv.Anonymous.Anonymous.vt == VT_LPWSTR {
                            let ptr = pv.Anonymous.Anonymous.Anonymous.pwszVal;
                            if !ptr.is_null() {
                                if let Ok(friendly) = ptr.to_string() {
                                    if friendly.contains(dev_name) || dev_name.contains(&friendly) {
                                        let _ = PropVariantClear(&mut pv);
                                        found = Some(dev);
                                        break;
                                    }
                                }
                            }
                        }
                        let _ = PropVariantClear(&mut pv);
                    }
                }
            }
        }

        match found {
            Some(d) => d,
            None => {
                tracing::warn!(
                    "WASAPI: device '{dev_name}' not found, using default render endpoint"
                );
                enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?
            }
        }
    };

    let audio_client: IAudioClient = mm_device.Activate::<IAudioClient>(CLSCTX_ALL, None)?;

    // IEEE float WAVEFORMATEX matching our ring buffer format.
    let wave_fmt = WAVEFORMATEX {
        wFormatTag:      WAVE_FORMAT_IEEE_FLOAT as u16,
        nChannels:       channels as u16,
        nSamplesPerSec:  sample_rate,
        nAvgBytesPerSec: sample_rate * channels * 4,
        nBlockAlign:     (channels * 4) as u16,
        wBitsPerSample:  32,
        cbSize:          0,
    };

    // 200ms buffer in 100-ns units.
    audio_client.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        2_000_000,
        0,
        &wave_fmt,
        None,
    )?;

    let capture_client: IAudioCaptureClient = audio_client.GetService()?;
    audio_client.Start()?;

    tracing::info!(
        "WASAPI loopback started: {} ch @ {} Hz (device='{}')",
        channels, sample_rate, dev_name
    );

    loop {
        if stop_rx.try_recv().is_ok() { break; }

        let mut p_data: *mut u8 = std::ptr::null_mut();
        let mut num_frames: u32 = 0;
        let mut flags: u32 = 0;

        match capture_client.GetBuffer(&mut p_data, &mut num_frames, &mut flags, None, None) {
            Ok(()) if num_frames > 0 => {
                let n_samples = num_frames as usize * channels as usize;
                // AUDCLNT_BUFFERFLAGS_SILENT (0x2)
                if flags & 0x2 != 0 {
                    for _ in 0..n_samples { let _ = prod.try_push(0.0f32); }
                } else {
                    let slice = std::slice::from_raw_parts(p_data as *const f32, n_samples);
                    prod.push_slice(slice);
                }
                let _ = capture_client.ReleaseBuffer(num_frames);
            }
            Ok(()) | Err(_) => {
                // No frames yet — yield to avoid busy-spinning.
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
        }
    }

    let _ = audio_client.Stop();
    tracing::info!("WASAPI loopback stopped (device='{dev_name}')");
    Ok(())
}