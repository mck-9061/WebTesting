function run() {
  if ("xr" in navigator) {
    const xr = navigator.xr
    navigator.xr.isSessionSupported("immersive-vr").then((result) => {
      if (result) {
        xr.requestSession("immersive-vr").then((session) => {
          let xrSession = session;
          /* continue to set up the session */
        });
      } else {
        document.getElementById("xr-remind").innerHTML="Your browser supports WebXR, but not immersive VR. Please open on a VR headset, such as an Oculus Quest or Samsung Gear VR."
      }
    })
  } else {
    document.getElementById("xr-remind").innerHTML="Your browser doesn't support WebXR. Please open on a VR headset, such as an Oculus Quest or Samsung Gear VR."
  }
}
