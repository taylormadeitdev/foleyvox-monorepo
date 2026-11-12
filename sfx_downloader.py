import os
import requests
import time

FREESOUND_KEY = os.getenv("FREESOUND_API_KEY")
FREESOUND_URL = "https://freesound.org/apiv2/search/text/"

def download_missing_sfx(sfx_list, sfx_dir="sfx"):
    if not os.path.exists(sfx_dir):
        os.makedirs(sfx_dir)

    for sfx in sfx_list:
        if sfx in ["none", "static"]:
            continue
            
        filename = os.path.join(sfx_dir, f"{sfx.replace(' ', '_')}.mp3")
        if os.path.exists(filename):
            continue
            
        if not FREESOUND_KEY:
            print(f"    [SFX] No Freesound API key. Skipping {sfx}.")
            continue

        print(f"    [SFX] Searching Freesound for: {sfx}...")
        params = {
            "query": sfx.replace("_", " "),
            "token": FREESOUND_KEY,
            "fields": "id,name,previews",
            "page_size": 1,
            "sort": "rating_desc"
        }
        
        try:
            res = requests.get(FREESOUND_URL, params=params, timeout=15).json()
            results = res.get("results", [])
            if results:
                preview = results[0]["previews"]["preview-hq-mp3"]
                audio = requests.get(preview, timeout=15)
                if audio.status_code == 200:
                    with open(filename, "wb") as f:
                        f.write(audio.content)
                    print(f"    [SFX] Downloaded: {sfx}")
                    time.sleep(1) # Respect Freesound rate limits
                else:
                    print(f"    [SFX] Failed to download audio for {sfx}")
            else:
                print(f"    [SFX] No match found for {sfx}")
        except Exception as e:
            print(f"    [SFX] Error downloading {sfx}: {e}")
