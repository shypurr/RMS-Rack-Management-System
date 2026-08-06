import PDFDocument from 'pdfkit';

// Printable picklist. Deliberately laid out to match the on-screen table —
// same columns, same order — so a picker holding the sheet and someone at the
// portal are reading the same thing.
//
// Streams into the response; pdfkit needs no headless browser.

const COLS = [
  { key: 'item', label: 'Item / Design', width: 150 },
  { key: 'color', label: 'Color', width: 75 },
  { key: 'size', label: 'Size', width: 55 },
  { key: 'qty', label: 'Qty', width: 40, align: 'right' },
  { key: 'racks', label: 'Rack', width: 175 },
];

const MARGIN = 40;
const ROW_PAD = 6;

// Printed on paper and read at arm's length on a warehouse floor, so the grid
// has to actually be visible — a hairline in a pale grey disappears entirely.
const BORDER = '#667085';
const BORDER_W = 0.8;
const TABLE_W = COLS.reduce((s, c) => s + c.width, 0);

// Vertical rules between columns plus the outer box, drawn once the row
// heights for a page are known (cell text comes first, lines on top).
function grid(doc, top, bottom) {
  doc.lineWidth(BORDER_W).strokeColor(BORDER);
  doc.rect(MARGIN, top, TABLE_W, bottom - top).stroke();
  let x = MARGIN;
  for (const c of COLS.slice(0, -1)) {
    x += c.width;
    doc.moveTo(x, top).lineTo(x, bottom).stroke();
  }
}

// pdfkit's standard-font encoding silently DROPS characters it can't map, so
// em dashes vanish mid-sentence. Plain ASCII punctuation throughout.
const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

function header(doc, picklist, orgName) {
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#111').text('Picklist', MARGIN, MARGIN);

  doc.font('Helvetica').fontSize(9).fillColor('#666');
  const right = doc.page.width - MARGIN;
  doc.text(orgName || '', MARGIN, MARGIN + 4, { width: right - MARGIN, align: 'right' });

  let y = MARGIN + 26;
  const meta = [
    picklist.dc_no ? ['Challan No', picklist.dc_no] : null,
    picklist.party ? ['Party', picklist.party] : null,
    ['Generated', fmtDate(picklist.created_at)],
    ['Total qty', String(picklist.total_qty)],
    picklist.short_qty > 0 ? ['Short', String(picklist.short_qty)] : null,
    ['Racks updated', picklist.rack_updated ? `Yes - ${picklist.picked_qty} picked on ${fmtDate(picklist.picked_at)}` : 'No'],
  ].filter(Boolean);

  for (const [label, value] of meta) {
    doc.font('Helvetica').fontSize(9).fillColor('#888').text(`${label}`, MARGIN, y, { width: 80 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#222').text(value, MARGIN + 85, y, { width: 380 });
    y += 14;
  }
  return y + 10;
}

// Returns the y below the header AND the header's own top edge, so the caller
// can close the grid over the full table at the end of each page.
function tableHead(doc, y) {
  const top = y;
  doc.rect(MARGIN, top, TABLE_W, 20).fillAndStroke('#eaecf0', BORDER);
  doc.lineWidth(BORDER_W).strokeColor(BORDER);
  let x = MARGIN;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#344054');
  for (const c of COLS) {
    doc.text(c.label, x + ROW_PAD, top + 6, { width: c.width - ROW_PAD * 2, align: c.align || 'left' });
    x += c.width;
  }
  return { y: top + 20, top };
}

export function renderPicklistPdf(picklist, orgName, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: {
    Title: picklist.dc_no ? `Picklist ${picklist.dc_no}` : `Picklist #${picklist.id}`,
  } });
  doc.pipe(stream);

  let y = header(doc, picklist, orgName);
  let head = tableHead(doc, y);
  y = head.y;
  let pageTop = head.top;

  doc.font('Helvetica').fontSize(9);
  for (const line of picklist.lines) {
    // Row height follows the tallest cell — a line sitting in several racks
    // wraps rather than overprinting the next row.
    const racks = line.racks || 'Not in any rack';
    const rackHeight = doc.heightOfString(racks, { width: COLS[4].width - ROW_PAD * 2 });
    const itemHeight = doc.heightOfString(line.item, { width: COLS[0].width - ROW_PAD * 2 });
    const rowHeight = Math.max(rackHeight, itemHeight, 12) + ROW_PAD * 2;

    if (y + rowHeight > doc.page.height - MARGIN - 20) {
      grid(doc, pageTop, y);          // close the grid before leaving the page
      doc.addPage();
      head = tableHead(doc, MARGIN);
      y = head.y;
      pageTop = head.top;
      doc.font('Helvetica').fontSize(9);
    }

    const cells = {
      item: line.item,
      color: line.color || '-',
      size: line.size || '-',
      qty: String(line.qty),
      racks,
    };

    let x = MARGIN;
    for (const c of COLS) {
      doc.fillColor(c.key === 'racks' && !line.racks ? '#b42318' : '#222');
      doc.text(cells[c.key], x + ROW_PAD, y + ROW_PAD, {
        width: c.width - ROW_PAD * 2, align: c.align || 'left',
      });
      x += c.width;
    }

    // Shortage is the one thing a picker must not miss on paper.
    if (line.shortage > 0) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#b42318')
        .text(`short by ${line.shortage}`, MARGIN + COLS[0].width + COLS[1].width + COLS[2].width + COLS[3].width - 60,
          y + ROW_PAD + 11, { width: 60, align: 'right' });
      doc.font('Helvetica').fontSize(9);
    }

    y += rowHeight;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + TABLE_W, y).lineWidth(BORDER_W).strokeColor(BORDER).stroke();
  }

  // Total sits inside the table as its last row, so the grid encloses it too.
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#101828')
    .text(`Total  ${picklist.total_qty}`, MARGIN, y + ROW_PAD, { width: TABLE_W - ROW_PAD, align: 'right' });
  y += 12 + ROW_PAD * 2;
  grid(doc, pageTop, y);

  doc.font('Helvetica').fontSize(8).fillColor('#98a2b3')
    .text('Generated by RMS - Rack Management System', MARGIN, doc.page.height - MARGIN - 10);

  doc.end();
}
