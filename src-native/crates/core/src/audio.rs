use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use sonicplank_ipc::AudioDeviceDef;
use ringbuf::{traits::{Producer, Consumer, Split}, HeapRb};

pub fn get_audio_devices() -> Result<Vec<AudioDeviceDef>> {
    let host = cpal::default_host();
    let mut devices = Vec::new();

    let default_input = host.default_input_device().map(|d| d.name().unwrap_or_default());
    let default_output = host.default_output_device().map(|d| d.name().unwrap_or_default());

    if let Ok(input_devices) = host.input_devices() {
        for device in input_devices {
            if let Ok(name) = device.name() {
                let is_default = default_input.as_ref() == Some(&name);
                devices.push(AudioDeviceDef {
                    id: format!("input:{}", name), // using name with prefix to disambiguate identical names
                    name: name.clone(),
                    is_input: true,
                    is_default,
                });
            }
        }
    }

    if let Ok(output_devices) = host.output_devices() {
        for device in output_devices {
            if let Ok(name) = device.name() {
                let is_default = default_output.as_ref() == Some(&name);
                // Windows WASAPI output devices can also be used as loopback input devices.
                devices.push(AudioDeviceDef {
                    id: format!("output:{}", name),
                    name: name.clone(),
                    is_input: false,
                    is_default,
                });
            }
        }
    }

    Ok(devices)
}

pub fn start_audio_capture(
    device_id: &str,
) -> Result<(cpal::Stream, ringbuf::HeapCons<f32>, cpal::StreamConfig)> {
    let host = cpal::default_host();
    
    let (is_input_prefix, search_name) = if let Some(stripped) = device_id.strip_prefix("input:") {
        (true, stripped)
    } else if let Some(stripped) = device_id.strip_prefix("output:") {
        (false, stripped)
    } else {
        // Fallback for old settings without prefix. Assume output since it's used for streaming loopback primarily.
        (false, device_id)
    };

    let device = if search_name.is_empty() {
        if is_input_prefix {
            host.default_input_device()
                .ok_or_else(|| anyhow!("No default input device"))?
        } else {
            host.default_output_device()
                .ok_or_else(|| anyhow!("No default output device"))?
        }
    } else {
        if is_input_prefix {
            host.input_devices()?
                .find(|x| x.name().unwrap_or_default() == search_name)
                .ok_or_else(|| anyhow!("Input device not found"))?
        } else {
            host.output_devices()?
                .find(|x| x.name().unwrap_or_default() == search_name)
                .ok_or_else(|| anyhow!("Output device not found"))?
        }
    };

    let config = if is_input_prefix {
        device.default_input_config()?
    } else {
        device.default_output_config()?
    };
    let sample_format = config.sample_format();
    let config: cpal::StreamConfig = config.into();

    let rb = HeapRb::<f32>::new(config.sample_rate.0 as usize * 4); // ~4 seconds buffer
    let (mut prod, cons) = rb.split();

    let err_fn = |err| tracing::error!("an error occurred on audio stream: {}", err);

    let stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _: &_| {
                prod.push_slice(data);
            },
            err_fn,
            None,
        )?,
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _: &_| {
                for &sample in data {
                    let _ = prod.try_push(sample as f32 / i16::MAX as f32);
                }
            },
            err_fn,
            None,
        )?,
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], _: &_| {
                for &sample in data {
                    let _ = prod.try_push((sample as f32 - u16::MAX as f32 / 2.0) / (u16::MAX as f32 / 2.0));
                }
            },
            err_fn,
            None,
        )?,
        _ => return Err(anyhow!("Unsupported sample format")),
    };

    stream.play()?;
    Ok((stream, cons, config))
}