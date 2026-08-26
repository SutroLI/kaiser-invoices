import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, statSync, createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const root = path.dirname(fileURLToPath(import.meta.url))
const pdfjsWasmDir = path.join(root, 'node_modules/pdfjs-dist/wasm')

function copyOcrAssets(): Plugin {
  const copy = () => {
    const dest = path.join(root, 'public', 'ocr')
    mkdirSync(dest, { recursive: true })
    const files: Array<[string, string]> = [
      [
        path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'),
        path.join(dest, 'worker.min.js'),
      ],
      [
        path.join(
          root,
          'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
        ),
        path.join(dest, 'tesseract-core-simd-lstm.wasm.js'),
      ],
    ]
    for (const [from, to] of files) {
      if (existsSync(from)) copyFileSync(from, to)
    }
  }

  return {
    name: 'copy-ocr-assets',
    buildStart: copy,
    configureServer: copy,
  }
}

const WASM_MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
}

function servePdfjsWasm(): Plugin {
  const serve = (
    req: { url?: string },
    res: { setHeader: (k: string, v: string) => void; end: () => void },
    next: () => void,
  ) => {
    const raw = req.url?.split('?')[0] ?? ''
    const url = decodeURIComponent(raw)
    const marker = '/pdfjs-wasm/'
    const idx = url.indexOf(marker)
    if (idx === -1) {
      next()
      return
    }
    const rel = url.slice(idx + marker.length)
    if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
      next()
      return
    }
    const file = path.join(pdfjsWasmDir, rel)
    if (!file.startsWith(pdfjsWasmDir) || !existsSync(file) || !statSync(file).isFile()) {
      next()
      return
    }
    res.setHeader('Content-Type', WASM_MIME[path.extname(file)] ?? 'application/octet-stream')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    createReadStream(file).pipe(res as unknown as NodeJS.WritableStream)
  }

  return {
    name: 'serve-pdfjs-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => serve(req, res, next))
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => serve(req, res, next))
    },
    generateBundle() {
      if (!existsSync(pdfjsWasmDir)) return
      for (const name of readdirSync(pdfjsWasmDir)) {
        const file = path.join(pdfjsWasmDir, name)
        if (!statSync(file).isFile()) continue
        this.emitFile({
          type: 'asset',
          fileName: `pdfjs-wasm/${name}`,
          source: readFileSync(file),
        })
      }
    },
  }
}

/** ORT wasm is loaded from jsDelivr at runtime — keep the 13–27MB files out of the site bundle. */
function skipOrtWasm(): Plugin {
  return {
    name: 'skip-ort-wasm',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/ort-wasm.*\.wasm$/i.test(fileName)) delete bundle[fileName]
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), copyOcrAssets(), servePdfjsWasm(), skipOrtWasm()],
  base: process.env.GITHUB_PAGES === 'true' ? '/kaiser-invoices/' : '/',
  optimizeDeps: {
    exclude: ['onnxruntime-web', 'ppu-paddle-ocr', 'ppu-ocv'],
  },
  resolve: {
    alias: {
      // createWorker.js always requires the Node adapter; force the browser one.
      [path.join(root, 'node_modules/tesseract.js/src/worker/node')]: path.join(
        root,
        'node_modules/tesseract.js/src/worker/browser',
      ),
    },
  },
})
