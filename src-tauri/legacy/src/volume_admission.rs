//! Windows workspace volume admission policy, ported from the upstream
//! `workspace-admission.ts` / `windows-volume-diagnostics.ts` decision table.

/// Drive types reported by `GetDriveTypeW`.
pub const DRIVE_REMOVABLE: u32 = 2;
pub const DRIVE_FIXED: u32 = 3;
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const DRIVE_REMOTE: u32 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub enum VolumeDecision {
    /// Local fixed NTFS/ReFS volume: persist immediately.
    Allow,
    /// Removable NTFS/ReFS volume: require explicit confirmation.
    Confirm,
    /// exFAT/FAT32, network, unknown, or uninspectable: never persist.
    Block,
}

/// Decide admission from the volume filesystem label and drive type.
/// Only NTFS/ReFS can pass at all; fixed drives pass, removable drives need a
/// confirmation, everything else (network, unknown, missing query) blocks.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn volume_admission(file_system: Option<&str>, drive_type: Option<u32>) -> VolumeDecision {
    let accepted_fs = file_system
        .map(|fs| {
            let upper = fs.trim().to_ascii_uppercase();
            upper == "NTFS" || upper == "REFS"
        })
        .unwrap_or(false);
    if !accepted_fs {
        return VolumeDecision::Block;
    }
    match drive_type {
        Some(DRIVE_FIXED) => VolumeDecision::Allow,
        Some(DRIVE_REMOVABLE) => VolumeDecision::Confirm,
        _ => VolumeDecision::Block,
    }
}

/// Query the filesystem label and drive type of the volume containing `path`.
/// Returns `None` when the volume cannot be inspected. Only implemented on
/// Windows; other platforms never call it.
#[cfg(target_os = "windows")]
pub fn query_volume(path: &str) -> Option<(String, u32)> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetVolumeInformationW};

    let root = volume_root(path)?;
    let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let drive_type = GetDriveTypeW(wide.as_ptr());
        let mut file_system = [0u16; 32];
        let ok = GetVolumeInformationW(
            wide.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            file_system.as_mut_ptr(),
            32,
        );
        if ok == 0 {
            return None;
        }
        let len = file_system.iter().position(|&value| value == 0).unwrap_or(0);
        let label = String::from_utf16_lossy(&file_system[..len]);
        if label.is_empty() {
            return None;
        }
        Some((label, drive_type))
    }
}

#[cfg(target_os = "windows")]
fn volume_root(path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    if bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/') {
        return Some(format!("{}:\\", bytes[0] as char).to_uppercase());
    }
    if path.starts_with("\\\\") {
        return Some(path.split('\\').take(4).collect::<Vec<_>>().join("\\") + "\\");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_ntfs_and_refs_are_allowed() {
        assert_eq!(volume_admission(Some("NTFS"), Some(DRIVE_FIXED)), VolumeDecision::Allow);
        assert_eq!(volume_admission(Some("ntfs"), Some(DRIVE_FIXED)), VolumeDecision::Allow);
        assert_eq!(volume_admission(Some("ReFS"), Some(DRIVE_FIXED)), VolumeDecision::Allow);
    }

    #[test]
    fn removable_ntfs_needs_confirmation() {
        assert_eq!(volume_admission(Some("NTFS"), Some(DRIVE_REMOVABLE)), VolumeDecision::Confirm);
        assert_eq!(volume_admission(Some("REFS"), Some(DRIVE_REMOVABLE)), VolumeDecision::Confirm);
    }

    #[test]
    fn exfat_fat32_network_and_unknown_block() {
        assert_eq!(volume_admission(Some("exFAT"), Some(DRIVE_FIXED)), VolumeDecision::Block);
        assert_eq!(volume_admission(Some("FAT32"), Some(DRIVE_FIXED)), VolumeDecision::Block);
        assert_eq!(volume_admission(Some("NTFS"), Some(DRIVE_REMOTE)), VolumeDecision::Block);
        assert_eq!(volume_admission(Some("NTFS"), Some(1)), VolumeDecision::Block);
        assert_eq!(volume_admission(Some("NTFS"), None), VolumeDecision::Block);
        assert_eq!(volume_admission(None, Some(DRIVE_FIXED)), VolumeDecision::Block);
        assert_eq!(volume_admission(None, None), VolumeDecision::Block);
    }
}
