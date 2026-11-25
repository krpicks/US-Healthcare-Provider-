import fs from 'node:fs';
import path from 'node:path';
import { buildUserManualPdf } from '../src/modules/m21-docs/pdfManualGenerator';

const outputDir = path.resolve(process.cwd(), 'public', 'docs');
const outputPath = path.join(outputDir, 'ProviderLink_User_Manual_Diagrams_ARD_ARB.pdf');

fs.mkdirSync(outputDir, { recursive: true });

const doc = buildUserManualPdf();
const buffer = Buffer.from(doc.output('arraybuffer'));
fs.writeFileSync(outputPath, buffer);

const header = buffer.subarray(0, 5).toString('ascii');
const pages = doc.getNumberOfPages();

if (header !== '%PDF-') {
  throw new Error(`Invalid PDF header generated: ${header}`);
}

process.stdout.write(
  `Generated ${outputPath} (${buffer.byteLength} bytes, ${pages} pages, header=${header})\n`,
);
