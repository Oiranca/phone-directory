use std::path::{Path, PathBuf};

const UNPACKED_CONTAINER_NAMES: [&str; 4] = ["win-unpacked", "linux-unpacked", "mac", "mac-arm64"];

#[derive(Debug, Eq, PartialEq)]
pub struct ManagedPaths {
    pub app_data_root: PathBuf,
    pub data_directory: PathBuf,
    pub backup_directory: PathBuf,
    pub contacts_file_path: PathBuf,
    pub settings_file_path: PathBuf,
    pub audit_log_file_path: PathBuf,
    pub beepers_file_path: PathBuf,
    pub legacy_beepers_file_path: PathBuf,
    pub crash_log_file_path: PathBuf,
}

pub fn resolve_portable_data_root(
    executable_path: &Path,
    app_image_path: Option<&Path>,
    is_packaged: bool,
) -> Option<PathBuf> {
    if !is_packaged {
        return None;
    }

    let root = app_image_path
        .filter(|path| path.is_absolute())
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| resolve_executable_root(executable_path));

    Some(root.join("portable-data"))
}

pub fn managed_paths(app_data_root: &Path) -> ManagedPaths {
    let data_directory = app_data_root.join("data");

    ManagedPaths {
        app_data_root: app_data_root.to_path_buf(),
        data_directory: data_directory.clone(),
        backup_directory: app_data_root.join("backups"),
        contacts_file_path: data_directory.join("contacts.json"),
        settings_file_path: data_directory.join("settings.json"),
        audit_log_file_path: data_directory.join("audit-log.json"),
        beepers_file_path: data_directory.join("beepers.json"),
        legacy_beepers_file_path: data_directory.join("buscas.json"),
        crash_log_file_path: data_directory.join("crash-log.jsonl"),
    }
}

fn resolve_executable_root(executable_path: &Path) -> PathBuf {
    let executable_directory = executable_path.parent().unwrap_or(executable_path);
    let contents_directory = executable_directory.parent();
    let bundle_directory = contents_directory.and_then(Path::parent);

    if executable_directory.file_name().is_some_and(|name| name == "MacOS")
        && contents_directory
            .and_then(Path::file_name)
            .is_some_and(|name| name == "Contents")
        && bundle_directory
            .filter(|path| path.extension().is_some_and(|extension| extension == "app"))
            .is_some()
    {
        let app_container = bundle_directory
            .and_then(Path::parent)
            .expect("a macOS app bundle has a parent directory");

        return if is_unpacked_container(app_container) {
            app_container
                .parent()
                .expect("an unpacked app container has a parent directory")
                .to_path_buf()
        } else {
            app_container.to_path_buf()
        };
    }

    if is_unpacked_container(executable_directory) {
        executable_directory
            .parent()
            .expect("an unpacked executable directory has a parent directory")
            .to_path_buf()
    } else {
        executable_directory.to_path_buf()
    }
}

fn is_unpacked_container(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| UNPACKED_CONTAINER_NAMES.iter().any(|container| name == *container))
}

#[cfg(test)]
mod tests {
    use super::{managed_paths, resolve_portable_data_root};
    use std::path::Path;

    #[cfg(windows)]
    const PORTABLE_ROOT: &str = r"C:\HospitalUSB";
    #[cfg(not(windows))]
    const PORTABLE_ROOT: &str = "/Volumes/HospitalUSB";

    #[cfg(windows)]
    const APPIMAGE_EXECUTABLE: &str = r"C:\tmp\.mount_hospi\usr\bin\hospiagenda";
    #[cfg(not(windows))]
    const APPIMAGE_EXECUTABLE: &str = "/tmp/.mount_hospi/usr/bin/hospiagenda";

    fn portable_root() -> &'static Path {
        Path::new(PORTABLE_ROOT)
    }

    #[test]
    fn uses_the_executable_parent_for_a_packaged_app() {
        let root = portable_root();

        assert_eq!(
            resolve_portable_data_root(&root.join("HospiAgenda"), None, true),
            Some(root.join("portable-data"))
        );
    }

    #[test]
    fn unwraps_each_supported_container() {
        let root = portable_root();

        for container in ["win-unpacked", "linux-unpacked", "mac", "mac-arm64"] {
            assert_eq!(
                resolve_portable_data_root(&root.join(container).join("hospiagenda"), None, true),
                Some(root.join("portable-data"))
            );
        }
    }

    #[test]
    fn unwraps_a_macos_app_inside_an_unpacked_container() {
        let root = portable_root();

        assert_eq!(
            resolve_portable_data_root(
                &root
                    .join("mac-arm64")
                    .join("HospiAgenda.app")
                    .join("Contents")
                    .join("MacOS")
                    .join("HospiAgenda"),
                None,
                true,
            ),
            Some(root.join("portable-data"))
        );
    }

    #[test]
    fn uses_the_app_container_for_a_directly_packaged_macos_app() {
        let root = portable_root();

        assert_eq!(
            resolve_portable_data_root(
                &root
                    .join("HospiAgenda.app")
                    .join("Contents")
                    .join("MacOS")
                    .join("HospiAgenda"),
                None,
                true,
            ),
            Some(root.join("portable-data"))
        );
    }

    #[test]
    fn prefers_an_absolute_appimage_parent() {
        let root = portable_root();

        assert_eq!(
            resolve_portable_data_root(
                Path::new(APPIMAGE_EXECUTABLE),
                Some(&root.join("HospiAgenda.AppImage")),
                true,
            ),
            Some(root.join("portable-data"))
        );
    }

    #[test]
    fn ignores_a_relative_appimage_path() {
        let root = portable_root();

        assert_eq!(
            resolve_portable_data_root(
                &root.join("HospiAgenda"),
                Some(Path::new("HospiAgenda.AppImage")),
                true,
            ),
            Some(root.join("portable-data"))
        );
    }

    #[test]
    fn keeps_the_platform_data_root_during_development() {
        assert_eq!(
            resolve_portable_data_root(&portable_root().join("HospiAgenda"), None, false),
            None
        );
    }

    #[test]
    fn preserves_the_current_managed_file_names() {
        let root = portable_root().join("portable-data");
        let paths = managed_paths(&root);

        assert_eq!(paths.app_data_root, root);
        assert_eq!(paths.data_directory, root.join("data"));
        assert_eq!(paths.backup_directory, root.join("backups"));
        assert_eq!(paths.contacts_file_path, root.join("data/contacts.json"));
        assert_eq!(paths.settings_file_path, root.join("data/settings.json"));
        assert_eq!(paths.audit_log_file_path, root.join("data/audit-log.json"));
        assert_eq!(paths.beepers_file_path, root.join("data/beepers.json"));
        assert_eq!(paths.legacy_beepers_file_path, root.join("data/buscas.json"));
        assert_eq!(paths.crash_log_file_path, root.join("data/crash-log.jsonl"));
    }
}
