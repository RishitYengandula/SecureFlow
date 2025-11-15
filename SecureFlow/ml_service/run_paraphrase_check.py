import os
import sys
import json
try:
    import torch
except Exception as e:
    print('Failed importing torch:', e)
    torch = None

try:
    from semantic_sanitizer import sanitize_context_semantic
except Exception as e:
    print('Failed importing semantic_sanitizer.sanitize_context_semantic:', e)
    raise

print('CWD:', os.getcwd())
print('Python executable:', sys.executable)
print('PARAPHRASE_MODEL:', os.getenv('PARAPHRASE_MODEL'))
print('torch version:', getattr(torch, '__version__', 'not installed'))
if torch is not None:
    try:
        print('CUDA available:', torch.cuda.is_available())
        print('CUDA device count:', torch.cuda.device_count())
        if torch.cuda.is_available():
            try:
                print('Device name:', torch.cuda.get_device_name(0))
            except Exception as e:
                print('Device name check failed:', e)
    except Exception as e:
        print('Error checking CUDA:', e)

sample = 'The CEO of our Hyderabad office said layoffs will start next week.'
print('\nRunning sanitize_context_semantic on sample:')
try:
    res = sanitize_context_semantic(sample)
    print(json.dumps(res, ensure_ascii=False, indent=2))
except Exception as e:
    print('Sanitizer call failed:', e)
