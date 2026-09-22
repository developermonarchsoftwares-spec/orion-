import jsPDF from 'jspdf';
import { TransactionRecord } from '@/types/admin';

export function generateInvoicePdf(tx: TransactionRecord) {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const primaryColor = [15, 23, 42]; // dark slate #0f172a
    const accentColor = [59, 130, 246]; // blue #3b82f6
    const textColor = [51, 65, 85]; // slate #334155
    const lightBg = [248, 250, 252]; // slate-50

    // Top Header Banner
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(0, 0, 210, 32, 'F');

    // Title / Brand Name in Header
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('ORION DATA PLATFORM', 14, 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(203, 213, 225);
    doc.text('Monarch Softwares Product Labs • GSTIN: 29AABCU9603R1ZM', 14, 25);

    // TAX INVOICE Header Label
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('TAX INVOICE / RECEIPT', 140, 18, { align: 'left' });

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(203, 213, 225);
    doc.text(`ORIGINAL FOR RECIPIENT`, 140, 25);

    // Metadata Section Box
    let y = 42;

    doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
    doc.roundedRect(14, y, 182, 35, 2, 2, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(14, y, 182, 35, 2, 2, 'D');

    // Left Box: Billed To
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('BILLED TO:', 18, y + 8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(tx.customerName || 'Valued Customer', 18, y + 15);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.text(`Company: ${tx.company || 'N/A'}`, 18, y + 21);
    doc.text(`Email: ${tx.customerEmail || 'N/A'}`, 18, y + 27);

    // Right Box: Invoice Meta Details
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('INVOICE NO:', 120, y + 8);
    doc.text('DATE & TIME:', 120, y + 14);
    doc.text('TRANSACTION ID:', 120, y + 20);
    doc.text('PAYMENT METHOD:', 120, y + 26);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(tx.receiptNumber || `RCP-${tx.id.slice(0, 6)}`, 155, y + 8);
    doc.setFont('helvetica', 'normal');
    doc.text(tx.date || new Date().toISOString().split('T')[0], 155, y + 14);
    doc.text(tx.id || 'TXN-999', 155, y + 20);
    doc.text(tx.paymentMethod || 'Razorpay UPI', 155, y + 26);

    // Itemized Table Header
    y = 86;
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(14, y, 182, 9, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('ITEM DESCRIPTION', 18, y + 6);
    doc.text('QTY / CREDITS', 110, y + 6, { align: 'center' });
    doc.text('SAC / HSN', 145, y + 6, { align: 'center' });
    doc.text('AMOUNT (INR)', 190, y + 6, { align: 'right' });

    // Table Content Row 1
    y = 95;
    doc.setFillColor(255, 255, 255);
    doc.rect(14, y, 182, 14, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.line(14, y + 14, 196, y + 14);

    const totalAmount = tx.amount || 0;
    const baseAmount = Math.round((totalAmount / 1.18) * 100) / 100;
    const gstAmount = Math.round((totalAmount - baseAmount) * 100) / 100;

    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`Orion Platform ${tx.plan || 'Starter'} Plan - Credits Package`, 18, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Includes ${tx.creditsPurchased.toLocaleString()} B2B Lead Unlock Credits`, 18, y + 11);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9.5);
    doc.text(`+${tx.creditsPurchased.toLocaleString()}`, 110, y + 8, { align: 'center' });
    doc.text('998313', 145, y + 8, { align: 'center' });
    doc.text(`Rs. ${baseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 190, y + 8, { align: 'right' });

    // Calculation Summary Table
    y = 118;

    doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
    doc.roundedRect(110, y, 86, 42, 2, 2, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(110, y, 86, 42, 2, 2, 'D');

    let sumY = y + 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('Subtotal (Base Value):', 114, sumY);
    doc.text(`Rs. ${baseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 192, sumY, { align: 'right' });

    sumY += 7;
    doc.text('IGST @ 18%:', 114, sumY);
    doc.text(`Rs. ${gstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 192, sumY, { align: 'right' });

    sumY += 7;
    doc.setDrawColor(203, 213, 225);
    doc.line(114, sumY - 2, 192, sumY - 2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('TOTAL AMOUNT PAID:', 114, sumY + 5);
    doc.setTextColor(37, 99, 235);
    doc.text(`Rs. ${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 192, sumY + 5, { align: 'right' });

    // Payment Status Stamp Box
    y = 118;
    doc.setFillColor(240, 253, 244); // light green bg
    doc.roundedRect(14, y, 88, 42, 2, 2, 'F');
    doc.setDrawColor(187, 247, 208);
    doc.roundedRect(14, y, 88, 42, 2, 2, 'D');

    doc.setTextColor(22, 101, 52); // green-800
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('PAYMENT STATUS: COMPLETED', 18, y + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(`Verified via ${tx.paymentMethod}`, 18, y + 17);
    doc.text(`Transaction Reference: ${tx.id}`, 18, y + 23);
    doc.text('Thank you for subscribing to Orion Data Platform.', 18, y + 33);

    // Terms & Declaration Section
    y = 170;
    doc.setDrawColor(226, 232, 240);
    doc.line(14, y, 196, y);

    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('TERMS & CONDITIONS & STATUTORY NOTES:', 14, y);

    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('1. All platform credits purchased are non-transferable and subject to Orion Terms of Service.', 14, y);
    doc.text('2. This document is a computer-generated Tax Invoice and requires no physical signature under Indian IT Act 2000.', 14, y + 4);
    doc.text('3. For billing support, GST invoicing queries, or Enterprise tax compliance, email sales@monarchsoftwares.com.', 14, y + 8);

    // Authorized Signatory Stamp Box
    doc.setDrawColor(203, 213, 225);
    doc.line(145, y + 22, 192, y + 22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('For MONARCH SOFTWARES LTD', 145, y + 26);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Authorized Finance Signatory', 145, y + 30);

    // Footer Copyright
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(0, 280, 210, 17, 'F');

    doc.setTextColor(203, 213, 225);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Orion Lead Intelligence Platform • Monarch Softwares Product Labs', 105, 288, { align: 'center' });
    doc.text('Support & Queries: sales@monarchsoftwares.com • Website: https://orion.ai', 105, 292, { align: 'center' });

    // Save PDF
    const filename = `Invoice_${tx.receiptNumber || tx.id}.pdf`;
    doc.save(filename);
  } catch (err) {
    console.error('Failed to generate PDF invoice with jsPDF:', err);
    // Fallback: Formatted Printable HTML Window
    openPrintableInvoiceWindow(tx);
  }
}

export function openPrintableInvoiceWindow(tx: TransactionRecord) {
  const totalAmount = tx.amount || 0;
  const baseAmount = Math.round((totalAmount / 1.18) * 100) / 100;
  const gstAmount = Math.round((totalAmount - baseAmount) * 100) / 100;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Tax Invoice - ${tx.receiptNumber}</title>
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #1e293b; margin: 0; padding: 24px; font-size: 13px; }
        .invoice-box { max-width: 800px; margin: auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
        .header { background: #0f172a; color: #fff; padding: 24px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { margin: 0; font-size: 22px; letter-spacing: 0.5px; }
        .header p { margin: 4px 0 0 0; color: #cbd5e1; font-size: 12px; }
        .badge { background: #3b82f6; color: #fff; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; }
        .meta-container { display: flex; justify-content: space-between; padding: 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
        .meta-col { flex: 1; }
        .meta-title { font-size: 11px; text-transform: uppercase; font-weight: bold; color: #64748b; margin-bottom: 4px; }
        .meta-val { font-size: 13px; font-weight: 600; color: #0f172a; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { background: #0f172a; color: #fff; text-align: left; padding: 10px 14px; font-size: 11px; text-transform: uppercase; }
        td { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; }
        .total-box { display: flex; justify-content: flex-end; padding: 20px; }
        .total-table { width: 300px; }
        .total-table td { border: none; padding: 4px 0; }
        .grand-total { font-size: 16px; font-weight: bold; color: #2563eb; }
        .footer { background: #f8fafc; text-align: center; padding: 16px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }
        @media print {
          .no-print { display: none; }
          .invoice-box { border: none; }
        }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 16px; text-align: right;">
        <button onclick="window.print()" style="background: #0f172a; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold;">Print / Save as PDF</button>
      </div>

      <div class="invoice-box">
        <div class="header">
          <div>
            <h1>ORION DATA PLATFORM</h1>
            <p>Monarch Softwares Product Labs • GSTIN: 29AABCU9603R1ZM</p>
          </div>
          <div style="text-align: right;">
            <div class="badge">OFFICIAL TAX INVOICE</div>
            <p style="margin-top: 6px;">Original for Recipient</p>
          </div>
        </div>

        <div class="meta-container">
          <div class="meta-col">
            <div class="meta-title">Billed To</div>
            <div class="meta-val">${tx.customerName}</div>
            <div>${tx.company}</div>
            <div style="color: #64748b;">${tx.customerEmail}</div>
          </div>
          <div class="meta-col" style="text-align: right;">
            <div class="meta-title">Receipt Details</div>
            <div><strong>Receipt No:</strong> ${tx.receiptNumber}</div>
            <div><strong>Txn ID:</strong> ${tx.id}</div>
            <div><strong>Date:</strong> ${tx.date}</div>
            <div><strong>Method:</strong> ${tx.paymentMethod}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th style="text-align: center;">Credits</th>
              <th style="text-align: center;">SAC Code</th>
              <th style="text-align: right;">Amount (INR)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Orion ${tx.plan || 'Starter'} Plan Credits Package</strong><br/>
                <span style="color: #64748b; font-size: 11px;">Includes ${tx.creditsPurchased.toLocaleString()} B2B Lead Unlock Credits</span>
              </td>
              <td style="text-align: center; font-weight: bold;">+${tx.creditsPurchased.toLocaleString()}</td>
              <td style="text-align: center;">998313</td>
              <td style="text-align: right; font-weight: bold;">₹${baseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          </tbody>
        </table>

        <div class="total-box">
          <table class="total-table">
            <tr>
              <td>Subtotal (Base Value):</td>
              <td style="text-align: right;">₹${baseAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td>IGST @ 18%:</td>
              <td style="text-align: right;">₹${gstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr style="border-top: 1px solid #cbd5e1;">
              <td class="grand-total">Total Paid:</td>
              <td style="text-align: right;" class="grand-total">₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          </table>
        </div>

        <div class="footer">
          <p style="margin: 0;">Computer generated invoice. No physical signature required under Indian IT Act 2000.</p>
          <p style="margin: 4px 0 0 0;">Support: sales@monarchsoftwares.com • Website: https://orion.ai</p>
        </div>
      </div>

      <script>
        window.onload = function() {
          setTimeout(function() { window.print(); }, 500);
        };
      </script>
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
  }
}
