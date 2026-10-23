#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pdf-qr-extractor.py
Extrai de forma real imagens e texto de PDFs oficiais do TSE e decodifica QR Codes (QRBU e QRCE) usando zxing-cpp e pymupdf.
"""

import sys
sys.stdout.reconfigure(encoding='utf-8')
import os
import json
import io
import pymupdf
import zxingcpp
from PIL import Image

def extract_pdf_data(pdf_path):
    if not os.path.exists(pdf_path):
        return {"error": f"File not found: {pdf_path}"}

    doc = pymupdf.open(pdf_path)
    pages_data = []
    qrbu_parts = []
    qrce_parts = []
    other_barcodes = []

    for page_idx, page in enumerate(doc):
        page_num = page_idx + 1
        page_text = page.get_text()
        images_info = []

        images = page.get_images()
        for img_idx, img in enumerate(images):
            xref = img[0]
            base_img = doc.extract_image(xref)
            img_bytes = base_img["image"]
            pil_img = Image.open(io.BytesIO(img_bytes))

            barcodes = zxingcpp.read_barcodes(pil_img)
            for b in barcodes:
                raw_text = b.text
                fmt = b.format.name if hasattr(b.format, 'name') else str(b.format)
                
                b_info = {
                    "imageIndex": img_idx + 1,
                    "xref": xref,
                    "width": pil_img.size[0],
                    "height": pil_img.size[1],
                    "format": fmt,
                    "rawLength": len(raw_text),
                    "rawText": raw_text
                }

                if raw_text.startswith("QRBU:"):
                    # Split e.g. QRBU:1:1
                    parts = raw_text.split(" ")
                    hdr = parts[0].split(":")
                    part_idx = int(hdr[1])
                    total_parts = int(hdr[2])
                    b_info["type"] = "QRBU"
                    b_info["partIndex"] = part_idx
                    b_info["totalParts"] = total_parts
                    qrbu_parts.append(b_info)
                elif raw_text.startswith("QRCE:"):
                    parts = raw_text.split(" ")
                    hdr = parts[0].split(":")
                    part_idx = int(hdr[1])
                    total_parts = int(hdr[2])
                    b_info["type"] = "QRCE"
                    b_info["partIndex"] = part_idx
                    b_info["totalParts"] = total_parts
                    qrce_parts.append(b_info)
                else:
                    b_info["type"] = "OTHER"
                    other_barcodes.append(b_info)

                images_info.append(b_info)

        pages_data.append({
            "pageNumber": page_num,
            "text": page_text,
            "imagesCount": len(images),
            "barcodes": images_info
        })

    # Ordenar partes
    qrbu_parts.sort(key=lambda x: x.get("partIndex", 0))
    qrce_parts.sort(key=lambda x: x.get("partIndex", 0))

    return {
        "pdfPath": pdf_path,
        "fileSize": os.path.getsize(pdf_path),
        "pageCount": len(doc),
        "pages": pages_data,
        "qrbuParts": qrbu_parts,
        "qrceParts": qrce_parts,
        "otherBarcodes": other_barcodes
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python pdf-qr-extractor.py <pdf_path>"}))
        sys.exit(1)

    pdf_file = sys.argv[1]
    res = extract_pdf_data(pdf_file)
    print(json.dumps(res, ensure_ascii=False, indent=2))
