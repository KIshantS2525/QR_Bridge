# QR Bridge

Move a sentence, an audio clip, or an image from your laptop to your phone using
**only QR codes read by the camera** — no file is ever sent over Wi-Fi, Bluetooth,
or the internet. The two pages talk to each other purely through light.

```
laptop (send.html)  --[ blinking QR codes on screen ]-->  phone (receive.html)
```

## 1. Run the server

No install step — it only uses Node's built-ins.

```
node server.js
```

You'll see one or two URLs printed, plus your machine's local network IP
addresses (e.g. `192.168.1.23`).

## 2. The one gotcha: HTTPS for the camera

Phones (especially iPhones) will **refuse camera access** on a page loaded
over plain `http://` unless the address is literally `localhost`. Since the
phone needs to open your laptop's IP address, not localhost, you need HTTPS.

Two-minute fix using a self-signed certificate:

```bash
# from inside the qr-bridge folder
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout certs/key.pem -out certs/cert.pem \
  -subj "/CN=qr-bridge.local"
```

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
streaming it live — handy if you want to text/AirDrop the video to the phone
separately and play it back later, or just keep a copy.

## How the encoding works

- Each QR frame carries at most ~480 base64 characters of payload. That's a
  deliberate ceiling: a smaller, sparser QR code is one a phone camera can
  actually lock onto at a few frames per second. Push the frame size up and
  you need fewer frames, but the phone needs a steadier hand and better focus
  to read each one.
- Multi-frame transfers wrap each chunk in a small JSON envelope
  (`{id, i, n, mime, data}`) so the receiver knows the frame's position and
  total count and can reassemble them in any order, from any starting point.
- A single short sentence skips the envelope entirely — it's sent as plain
  text in one QR code.
- The **Speed** slider controls how long each frame stays on screen
  (150–900ms). Slower is more reliable for an unsteady camera or a dim room;
  faster finishes sooner once you've got a good scanning distance dialed in.

## Realistic expectations

This is light literally standing in for a network cable, so it inherits QR
code's real limits: a photo of a few hundred KB might mean scanning 40–80
individual frames, which takes a minute or two of steady scanning. It's a fun,
genuinely airgapped way to move small things — a paragraph, a voice memo, an
icon-sized image — not a replacement for AirDrop on a big video file.

## Files

```
server.js        zero-dependency static file server (HTTP + optional HTTPS)
public/
  index.html     landing page — choose laptop or phone
  send.html/.js  laptop interface: compose → QR frames
  receive.html/.js phone interface: camera → jsQR → reassembled result
  shared.js      chunking / reassembly logic used by both sides
  styles.css     shared visual design
```
