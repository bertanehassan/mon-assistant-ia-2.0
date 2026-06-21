import re

def fix_file(filepath, outpath):
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()

    def fix_word(m):
        word = m.group(0)
        # First try the whole sequence
        try:
            b = word.encode('cp1256')
            return b.decode('utf-8')
        except:
            pass
        
        # Process character by character for valid UTF-8 sequences in cp1256
        res = ""
        i = 0
        while i < len(word):
            matched = False
            # UTF-8 characters are up to 4 bytes, so try length 4 to 2
            for length in [4, 3, 2]:
                if i + length <= len(word):
                    chunk = word[i:i+length]
                    try:
                        b = chunk.encode('cp1256')
                        fixed = b.decode('utf-8')
                        # Ensure it's not mapping to something empty or just weird, 
                        # but if it decodes cleanly to utf-8, it's very likely valid mojibake!
                        res += fixed
                        i += length
                        matched = True
                        break
                    except Exception:
                        pass
            if not matched:
                res += word[i]
                i += 1
        return res

    # We match any sequence of non-ASCII characters, including spaces, because mojibake might contain spaces (e.g., NBSP)
    # Actually, Windows-1256 has characters that might be mapped to spaces.
    # Let's just run it on ALL non-ascii characters and some ascii that might be part of the mojibake.
    # Mojibake bytes in CP1256 could map to printable ASCII? 
    # No, CP1256 bytes 0x00-0x7F are identical to ASCII!
    # So Mojibake for UTF-8 (bytes > 0x7F) will ONLY map to CP1256 characters > 0x7F.
    # Therefore, Mojibake characters are ALWAYS outside standard ASCII (except maybe some control chars, but mostly > 0x7F).
    # Wait, 0x80 to 0xFF in CP1256 are mapped to various Unicode.
    # So finding `[^\x00-\x7F]+` perfectly captures all Mojibake!
    
    new_text = re.sub(r'[^\x00-\x7F]+', fix_word, text)
    
    if new_text != text:
        with open(outpath, 'w', encoding='utf-8') as f:
            f.write(new_text)
        print("Fixed", filepath)
    else:
        print("No changes in", filepath)

fix_file('src/legacy.js', 'src/legacy.js')
fix_file('src/i18n.js', 'src/i18n.js')
