CLIP CLAP WEBSITE — SIMPLE SETUP

FILES
- index.html      = website
- latest.json     = current version + installer download link

NEXT STEPS

1. Put these website files in:
   C:\Users\city\Desktop\Clip Clap Website

2. Keep Clip-Clap-Setup-0.8.1.exe there only as your local copy.
   For public download, upload the EXE to a public file host first.

3. Open latest.json with Notepad.

4. Change:
   "download_url": "#"

   to your public installer URL, for example:
   "download_url": "https://your-file-host/Clip-Clap-Setup-0.8.1.exe"

5. Save latest.json.

6. In Vercel New Project:
   click "a folder"
   select:
   C:\Users\city\Desktop\Clip Clap Website

7. Deploy.

8. In the Vercel project:
   Settings > Domains
   add:
   clipclap.mskmpt.pro

9. Vercel will show the exact DNS record.
   Put that exact record in Porkbun.
   DO NOT guess the target.

HOW FUTURE WEBSITE UPDATES WORK

When Clip Clap v0.8.2 or v0.9.0 is released:

1. Upload the new installer to your file host.
2. Edit latest.json:
   - version
   - download_url
   - released
3. Redeploy Vercel.

The website download button automatically points to the latest installer.

FUTURE IN-APP UPDATE CHECK

The same latest.json can later be used by Clip Clap's
"Check for Updates" feature.

Important:
The CURRENT app should not be claimed to auto-update unless that feature
has actually been implemented and tested.
Website connected to Vercel.
