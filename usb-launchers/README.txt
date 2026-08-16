HospiAgenda -- USB Instructions
================================

This USB drive contains a portable build of HospiAgenda. The packaged app
automatically stores contacts, buscas, settings, and backups in portable-data
at the USB root. No launcher or installation is required.

WINDOWS
-------
Double-click HospiAgenda.exe at the USB root.

MACOS
-----
Open HospiAgenda.app inside mac/ (Intel) or mac-arm64/ (Apple Silicon).
If macOS blocks the unsigned app, Control-click it, choose Open, then Open.

LINUX
-----
Run linux-unpacked/hospiagenda directly. If its executable bit was lost:
  chmod +x linux-unpacked/hospiagenda

launch.sh remains only as a compatibility fallback for systems that cannot
mount AppImages with FUSE. Normal launches do not require it.

DATA STORAGE
------------
All persistent data stays in portable-data on this USB drive:

  portable-data/
    data/
      contacts.json
      beepers.json
      settings.json
    backups/

To back up your data, copy portable-data to a safe location.
