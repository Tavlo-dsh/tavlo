use std::io::Write;

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

pub fn build_zip_store(files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut local = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let name_bytes = name.as_bytes();
        let crc = crc32(data);
        let offset = local.len() as u32;
        local.write_all(&0x0403_4b50u32.to_le_bytes()).unwrap();
        local.write_all(&20u16.to_le_bytes()).unwrap();
        local.write_all(&0u16.to_le_bytes()).unwrap();
        local.write_all(&0u16.to_le_bytes()).unwrap();
        local.write_all(&0u16.to_le_bytes()).unwrap();
        local.write_all(&0u16.to_le_bytes()).unwrap();
        local.write_all(&crc.to_le_bytes()).unwrap();
        local.write_all(&(data.len() as u32).to_le_bytes()).unwrap();
        local.write_all(&(data.len() as u32).to_le_bytes()).unwrap();
        local.write_all(&(name_bytes.len() as u16).to_le_bytes()).unwrap();
        local.write_all(&0u16.to_le_bytes()).unwrap();
        local.write_all(name_bytes).unwrap();
        local.write_all(data).unwrap();

        central.write_all(&0x0201_4b50u32.to_le_bytes()).unwrap();
        central.write_all(&20u16.to_le_bytes()).unwrap();
        central.write_all(&20u16.to_le_bytes()).unwrap();
        central.write_all(&0u16.to_le_bytes()).unwrap();
        central.write_all(&0u16.to_le_bytes()).unwrap();
        central.write_all(&0u16.to_le_bytes()).unwrap();
        central.write_all(&0u16.to_le_bytes()).unwrap();
        central.write_all(&crc.to_le_bytes()).unwrap();
        central.write_all(&(data.len() as u32).to_le_bytes()).unwrap();
        central.write_all(&(data.len() as u32).to_le_bytes()).unwrap();
        central.write_all(&(name_bytes.len() as u16).to_le_bytes()).unwrap();
        central.write_all(&0u16.to_le_bytes()).unwrap();
        central.write_all(&0u16.to_le_bytes()).unwrap();
        central.write_all(&0u16.to_le_bytes()).unwrap();
        central.write_all(&0u16.to_le_bytes()).unwrap();
        central.write_all(&0u32.to_le_bytes()).unwrap();
        central.write_all(&offset.to_le_bytes()).unwrap();
        central.write_all(name_bytes).unwrap();
    }
    let mut zip = local;
    let central_offset = zip.len() as u32;
    zip.extend_from_slice(&central);
    zip.write_all(&0x0605_4b50u32.to_le_bytes()).unwrap();
    zip.write_all(&0u16.to_le_bytes()).unwrap();
    zip.write_all(&0u16.to_le_bytes()).unwrap();
    zip.write_all(&(files.len() as u16).to_le_bytes()).unwrap();
    zip.write_all(&(files.len() as u16).to_le_bytes()).unwrap();
    zip.write_all(&(central.len() as u32).to_le_bytes()).unwrap();
    zip.write_all(&central_offset.to_le_bytes()).unwrap();
    zip.write_all(&0u16.to_le_bytes()).unwrap();
    zip
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_archive_contains_entry_name_and_payload() {
        let zip = build_zip_store(&[("system-info.txt".into(), b"hello-diagnostics".to_vec())]);
        assert_eq!(&zip[0..4], b"PK\x03\x04");
        let as_text = String::from_utf8_lossy(&zip);
        assert!(as_text.contains("system-info.txt"));
        assert!(as_text.contains("hello-diagnostics"));
    }
}
