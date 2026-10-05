import os
import sys
import glob
import json
import traceback

sys.path.append(os.path.abspath('formato-arquivos-de-bu-rdv-e-assinatura-digital/python'))
import asn1tools

def process_all_bus():
    asn1_path = 'formato-arquivos-de-bu-rdv-e-assinatura-digital/spec/bu.asn1'
    bu_dir = 'BUs-Concordia-2026'
    
    # Compile schema once
    conv = asn1tools.compile_files([asn1_path], codec="ber", numeric_enums=True)
    
    files = glob.glob(os.path.join(bu_dir, '**', '*-bu.dat'), recursive=True)
    results = []
    
    for fpath in files:
        fname = os.path.basename(fpath)
        try:
            with open(fpath, "rb") as bu:
                encoded = bytearray(bu.read())
                
            envelope = conv.decode("EntidadeEnvelopeGenerico", encoded)
            bu_encoded = envelope["conteudo"]
            bu_decoded = conv.decode("EntidadeBoletimUrna", bu_encoded)
            
            results.append({
                'file': fname,
                'path': fpath,
                'decoded': bu_decoded
            })
            
        except Exception as e:
            results.append({
                'file': fname,
                'path': fpath,
                'error': str(e),
                'trace': traceback.format_exc()
            })
            
    with open('bu-decoded-dump.json', 'w') as f:
        def bytes_to_str(obj):
            if isinstance(obj, bytes) or isinstance(obj, bytearray):
                return obj.hex()
            raise TypeError
        json.dump(results, f, default=bytes_to_str, indent=2)

if __name__ == '__main__':
    process_all_bus()
