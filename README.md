# QR Bridge

Move a sentence, an audio clip, or an image from your laptop to your phone using
**only QR codes read by the camera** — no file is ever sent over Wi-Fi, Bluetooth,
or the internet. The two pages talk to each other purely through light.

```
laptop (send.html)  --[ blinking QR codes on screen ]-->  phone (receive.html)
```

Everything runs fully offline: the QR encode/decode libraries are bundled
locally in `public/vendor/`, so nothing is fetched from a CDN either — the
app works with no internet connection at all, only a shared local network.

## 1. Run the server

No install step — it only uses Node's built-ins.

```
node server.js
```

You'll see one or two URLs printed, plus your machine's local network IP
addresses (e.g. `192.168.1.23`).

## 2. HTTPS for the camera (needed once)

Phones (especially iPhones) will **refuse camera access** on a page loaded
over plain `http://` unless the address is literally `localhost`. Since the
phone needs to open your laptop's IP address, not localhost, you need HTTPS.

Two-minute fix using a self-signed certificate. In **Git Bash** (not
PowerShell — PowerShell's bundled tools don't include OpenSSL):

```bash
cd /path/to/qr-bridge
mkdir certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout certs/key.pem -out certs/cert.pem -subj "//CN=qr-bridge.local"
```

Note the **double slash** before `CN=` — Git Bash rewrites a single leading
slash into a Windows path, which breaks this command. `//CN=...` avoids that.

Restart `node server.js` — it now also serves HTTPS on port **3443** and will
print a `https://<your-ip>:3443` line. Open that on the phone; it will warn
that the certificate isn't trusted ("your connection isn't private") — that's
expected for a self-signed cert. Tap **Advanced → proceed anyway**. It only
warns once per device.

On the laptop you can use plain `http://localhost:3000` if you prefer — it
doesn't need HTTPS since it's not the one using the camera.

## 3. Use it

- Laptop: open `http://localhost:3000/send.html`, choose **Text**, **Audio**,
  or **Image**, and generate.
- Phone: open `https://<your-ip>:3443/receive.html`, tap **Start camera**,
  and point it at the laptop screen.

Short text produces one static QR code you can download as a PNG. Longer
text, audio clips, and images automatically split into a rapid sequence of
QR frames that loop continuously until you stop them — the phone shows a
progress bar as it collects frames and reassembles the original file once
every piece has been seen at least once. Missed a frame? It doesn't matter,
the sequence just keeps looping.

You can also **download the animated sequence as a `.webm` video** instead of
streaming it live — handy if you want to send the video to the phone
separately and play it back later, or just keep a copy.

## How the encoding works

- Each QR frame carries at most ~480 base64 characters of payload. That's a
  deliberate ceiling: a smaller, sparser QR code is one a phone camera can
  actually lock onto at a few frames per second.
- Multi-frame transfers wrap each chunk in a small JSON envelope
  (`{id, i, n, mime, data}`) so the receiver knows the frame's position and
  total count and can reassemble them in any order, from any starting point
  — including out-of-order or duplicated frames from a shaky scan.
- A single short sentence skips the envelope entirely — it's sent as plain
  text in one QR code.
- The **Speed** slider controls how long each frame stays on screen
  (150–900ms). Slower is more reliable for an unsteady camera or a dim room;
  faster finishes sooner once you've got a good scanning distance dialed in.

## Troubleshooting

**QR code area stays blank / white** — hard refresh the browser
(`Ctrl+Shift+R`) so it isn't using a cached copy of an old page. The QR
libraries load from `public/vendor/`, not the internet, so this shouldn't be
a network problem, but a stale cache can still show old broken code.

**Phone says "site can't be reached"** — this means the phone's request
isn't reaching the laptop at all, which is almost always one of:
- **Wrong IP.** Run `ipconfig` on the laptop and use the IPv4 address under
  the adapter actually named "Wireless LAN adapter Wi-Fi" — not a VPN,
  VirtualBox, or Hyper-V adapter, which also show up in the list but aren't
  reachable from another device.
- **Windows network profile set to Public.** Windows blocks inbound
  connections by default on Public networks. Settings → Network & Internet →
  Wi-Fi → your network → set profile to **Private**, then restart the server.
- **Windows Defender Firewall blocking Node.** Control Panel → System and
  Security → Windows Defender Firewall → "Allow an app through firewall" →
  make sure Node.js is listed and checked for both Private and Public. If
  it's missing, add it manually (`C:\Program Files\nodejs\node.exe`).
- **Router client/AP isolation**, common on guest Wi-Fi networks, which
  blocks devices on the same network from reaching each other even though
  both show as connected. Make sure both devices are on the exact same
  (non-guest) network, and disable isolation if your router has that option.

Test with `http://<ip>:3000/send.html` on the phone first (not https) to
confirm basic reachability before troubleshooting the certificate separately.

**Certificate warning on the phone** — expected for a self-signed cert.
Tap Advanced → proceed anyway; it only asks once per device.

## Realistic expectations

This is light literally standing in for a network cable, so it inherits QR
code's real limits: a photo of a few hundred KB might mean scanning 40–80
individual frames, which takes a minute or two of steady scanning. It's a fun,
genuinely airgapped way to move small things — a paragraph, a voice memo, an
icon-sized image — not a replacement for AirDrop on a big video file.

## Files

```
server.js            zero-dependency static file server (HTTP + optional HTTPS)
public/
  index.html          landing page — choose laptop or phone
  send.html/.js        laptop interface: compose → QR frames
  receive.html/.js     phone interface: camera → jsQR → reassembled result
  shared.js            chunking / reassembly logic used by both sides
  styles.css           shared visual design
  vendor/
    qrcode.min.js       QR encoder, bundled locally (no CDN)
    jsQR.js             QR decoder, bundled locally (no CDN)
certs/                (you create this) self-signed cert for HTTPS
  key.pem
  cert.pem
```
