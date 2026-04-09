# @yuyuyuyuyu-dev/html2pdf

`@yuyuyuyuyu-dev/html2pdf` converts HTML to PDF using Chromium.

## Prerequisites

Node.js, Chromium

**e.g.**
```bash
pkg install -y x11-repo
pkg install -y nodejs chromium
```

## Usage

```bash
npx @yuyuyuyuyu-dev/html2pdf --chromium-path {Chromium path} --src {Source HTML file path} --dest {Destination PDF path}
```

**e.g.**
```bash
npx @yuyuyuyuyu-dev/html2pdf --chromium-path $(type -p chromium) --src (TODO) --dest (TODO: Android Downloads path)
```

## License

MIT License
