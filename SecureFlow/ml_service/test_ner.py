import requests

url = "http://127.0.0.1:8000/ner"
text = "Google was founded by Larry Page and Sergey Brin in 1998 in California. Apple paid $10000 for acquisitions."
resp = requests.post(url, json={"text": text})
print(resp.status_code)
print(resp.text)
