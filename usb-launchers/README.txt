Phone Directory -- USB Launcher Instructions
============================================

This USB drive contains a portable build of Phone Directory.
Your contacts, settings, and backups are stored in a "portable-data" folder
on this drive alongside the launcher files.


WINDOWS
-------
Double-click "launch.bat" in Windows Explorer, or run it from a Command Prompt.

No installation required. The app will start and all data will be written to
the portable-data folder on this drive.


MACOS
-----
Double-click "launch.command". macOS may ask for permission the first time.

If macOS blocks it with "cannot be opened because the developer cannot be verified":
  1. Right-click (or Control-click) "launch.command"
  2. Choose "Open" from the context menu
  3. Click "Open" in the security dialog

You may also need to make the file executable first. Open Terminal and run:
  chmod +x /Volumes/<YourUSBName>/launch.command


LINUX
-----
Open a terminal, navigate to the USB drive, and run:
  chmod +x launch.sh
  ./launch.sh

The launcher tries "linux-unpacked/phone-directory" first. If that is not
present it falls back to "Phone Directory.AppImage" at the USB root.


DATA STORAGE
------------
All data (contacts.json, settings.json, backups/) is kept in a "portable-data"
folder on this USB drive. Nothing is written to your computer's home directory
or application data folders.

To back up your data, copy the "portable-data" folder to a safe location.
