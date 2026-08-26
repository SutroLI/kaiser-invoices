import { createWorker } from 'tesseract.js'

const files = process.argv.slice(2)
const worker = await createWorker('eng', 1)
await worker.setParameters({
  tessedit_pageseg_mode: '6',
  preserve_interword_spaces: '1',
})

for (const file of files) {
  console.log('\n==========', file, '==========')
  const { data } = await worker.recognize(file)
  console.log(data.text)
}

await worker.terminate()
