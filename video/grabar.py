import asyncio, glob, os, shutil, subprocess
from playwright.async_api import async_playwright
async def main():
    shutil.rmtree('/tmp/vid',ignore_errors=True)
    async with async_playwright() as p:
        br=await p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
        ctx=await br.new_context(viewport={"width":1280,"height":720},record_video_dir="/tmp/vid",record_video_size={"width":1280,"height":720})
        pg=await ctx.new_page()
        pg.on("console",lambda m: print("console:",m.text) if m.type in("error",) else None)
        await pg.goto("http://localhost:3222/video/storyboard.html")
        await pg.wait_for_function("window.__done===true",timeout=240000)
        print("err:",await pg.evaluate("window.__err||null"))
        await pg.screenshot(path="/tmp/shots/v_last.png")
        await ctx.close(); await br.close()
    f=glob.glob('/tmp/vid/*.webm')[0]
    subprocess.run(["ffmpeg","-y","-loglevel","error","-ss","0.6","-i",f,"-c:v","libx264","-pix_fmt","yuv420p","-crf","23","-preset","medium","-r","30","-movflags","+faststart","/tmp/camijuncal-demo.mp4"],check=True)
    print(os.path.getsize('/tmp/camijuncal-demo.mp4')/1e6,"MB")
asyncio.run(main())
