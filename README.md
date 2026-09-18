# QR File Transfer

Send files between two devices using nothing but a screen and a camera — no
Wi-Fi, Bluetooth, cables, or internet connection required. One device
displays an animated sequence of QR codes; the other scans them with its
camera and reassembles the file.

## How it works

- The file is split into blocks and streamed as a rapid sequence of QR
  codes on the sending device's screen.
- The receiving device scans that sequence with its camera and reassembles
  the file locally.
- Transfers are **fountain coded** (an LT-code style scheme): each QR frame
  is a combination of source blocks rather than one fixed chunk. Any
  sufficiently large set of scanned frames is enough to reconstruct the
  file, so a handful of missed or misread frames along the way doesn't
  stall the transfer — the receiver keeps making progress from whatever
  comes next, with no need to scrub back and rescan a specific frame.
- Every completed transfer is verified with a SHA-256 checksum end to end,
  and individual corrupted frames are rejected before they can affect
  anything already decoded.

## Features

- Send any file (or a batch of files, auto-bundled into one transfer)
- Record a voice clip from the microphone and send it directly
- Live camera scanning (hardware barcode detection where available, with a
  software fallback), or decode a single photo of a QR code
- Export the QR sequence as a downloadable video, for sharing through
  another channel and scanning later
- Adjustable transmission speed, manual frame scrubbing, and live progress
  on both ends
- Optional gzip compression applied automatically when it helps

## Getting started

Requires Node.js and npm.

```sh
npm install
npm run dev
```

### Other scripts

```sh
npm run build     # production build
npm run preview   # preview a production build locally
npm run test      # run the test suite
npm run lint      # lint the project
```

## Deployment

See [`DEPLOY.md`](./DEPLOY.md) for verified deployment instructions
(Vercel works with zero configuration changes).

## Tech stack

- TanStack Start
- TypeScript
- React
- Tailwind CSS
- Vitest
