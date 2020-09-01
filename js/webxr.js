import {WebXRButton} from './webxr-render/util/webxr-button.js';
import {Scene} from './webxr-render/render/scenes/scene.js';
import {Renderer, createWebGLContext} from './webxr-render/render/core/renderer.js';
import {Gltf2Node} from './webxr-render/render/nodes/gltf2.js';
import {SkyboxNode} from './webxr-render/render/nodes/skybox.js';
import {vec3} from './webxr-render/render/math/gl-matrix.js';
import {Ray} from './webxr-render/render/math/ray.js';
import {InlineViewerHelper} from './webxr-render/util/inline-viewer-helper.js';
import {QueryArgs} from './webxr-render/util/query-args.js';

// XR globals.
let xrButton = null;
let xrImmersiveRefSpace = null;
let inlineViewerHelper = null;

// WebGL scene globals.
let gl = null;
let renderer = null;
let scene = new Scene();
scene.standingStats(true);

export function initXR(environment, skybox) {
  scene.addNode(new Gltf2Node({url: 'media/webxr/gltf/'+environment+'/'+environment+'.gltf'}));
  scene.addNode(new SkyboxNode({url: 'media/webxr/textures/'+skybox}));
  xrButton = new WebXRButton({
    onRequestSession: onRequestSession,
    onEndSession: onEndSession
  });
  document.querySelectorAll('div')[4].appendChild(xrButton.domElement);

  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
      xrButton.enabled = supported;
      if (!supported) {
        document.getElementById("xr-remind").innerHTML = "Your browser supports WebXR but not immersive VR. Please open on a VR headset."
        document.getElementById("env-sel").hidden = true
        document.getElementById("skybox-sel").hidden = true
        document.getElementById("sel1").hidden = true
        document.getElementById("sel2").hidden = true
      }
    });
  } else {
    document.getElementById("xr-remind").innerHTML = "Your browser doesn't support WebXR. Please open on a VR headset."
    document.getElementById("env-sel").hidden = true
    document.getElementById("skybox-sel").hidden = true
    document.getElementById("sel1").hidden = true
    document.getElementById("sel2").hidden = true
  }
}

function initGL() {
  if (gl)
    return;

  gl = createWebGLContext({
    xrCompatible: true
  });

  // Note: If you don't want dragging on the canvas to do things like
  // scroll or pull-to-refresh, you'll want to set touch-action: none;
  // on the canvas' CSS style, which this page does in common.css
  document.body.appendChild(gl.canvas);

  function onResize() {
    gl.canvas.width = gl.canvas.clientWidth * window.devicePixelRatio;
    gl.canvas.height = gl.canvas.clientHeight * window.devicePixelRatio;
  }
  window.addEventListener('resize', onResize);
  onResize();

  renderer = new Renderer(gl);

  scene.setRenderer(renderer);

  // Loads a generic controller meshes.
  scene.inputRenderer.setControllerMesh(new Gltf2Node({url: 'media/webxr/gltf/controller/controller.gltf'}), 'right');
  scene.inputRenderer.setControllerMesh(new Gltf2Node({url: 'media/webxr/gltf/controller/controller-left.gltf'}), 'left');
}

function onRequestSession() {
  return navigator.xr.requestSession('immersive-vr', {
    requiredFeatures: ['local-floor']
  }).then((session) => {
    xrButton.setSession(session);
    session.isImmersive = true;
    onSessionStarted(session);
  });
}

function onSessionStarted(session) {
  session.addEventListener('end', onSessionEnded);

  initGL();

  let glLayer = new XRWebGLLayer(session, gl);
  session.updateRenderState({ baseLayer: glLayer });

  let refSpaceType = session.isImmersive ? 'local-floor' : 'viewer';
  session.requestReferenceSpace(refSpaceType).then((refSpace) => {
    if (session.isImmersive) {
      xrImmersiveRefSpace = refSpace;
    } else {
      inlineViewerHelper = new InlineViewerHelper(gl.canvas, refSpace);
      inlineViewerHelper.setHeight(1.6);
    }
    session.requestAnimationFrame(onXRFrame);
  });
}

function onEndSession(session) {
  session.end();
}

function onSessionEnded(event) {
  if (event.session.isImmersive) {
    xrButton.setSession(null);
  }
}

function updateInputSources(session, frame, refSpace) {
  for (let inputSource of session.inputSources) {
    let targetRayPose = frame.getPose(inputSource.targetRaySpace, refSpace);

    // We may not get a pose back in cases where the input source has lost
    // tracking or does not know where it is relative to the given frame
    // of reference.
    if (!targetRayPose) {
      continue;
    }

    if (inputSource.targetRayMode == 'tracked-pointer') {
      // If we have a pointer matrix and the pointer origin is the users
      // hand (as opposed to their head or the screen) use it to render
      // a ray coming out of the input device to indicate the pointer
      // direction.
      scene.inputRenderer.addLaserPointer(targetRayPose.transform);
    }

    // If we have a pointer matrix we can also use it to render a cursor
    // for both handheld and gaze-based input sources.

    // Statically render the cursor 2 meters down the ray since we're
    // not calculating any intersections in this sample.
    let targetRay = new Ray(targetRayPose.transform);
    let cursorDistance = 2.0;
    let cursorPos = vec3.fromValues(
      targetRay.origin.x,
      targetRay.origin.y,
      targetRay.origin.z
    );
    vec3.add(cursorPos, cursorPos, [
      targetRay.direction.x * cursorDistance,
      targetRay.direction.y * cursorDistance,
      targetRay.direction.z * cursorDistance,
    ]);
    // vec3.transformMat4(cursorPos, cursorPos, inputPose.targetRay.transformMatrix);

    scene.inputRenderer.addCursor(cursorPos);

    if (inputSource.gripSpace) {
      let gripPose = frame.getPose(inputSource.gripSpace, refSpace);
      if (gripPose) {
        // If we have a grip pose use it to render a mesh showing the
        // position of the controller.
        scene.inputRenderer.addController(gripPose.transform.matrix, inputSource.handedness);
      }
    }

  }
}

function onXRFrame(t, frame) {
  let session = frame.session;
  let refSpace = session.isImmersive ?
    xrImmersiveRefSpace :
    inlineViewerHelper.referenceSpace;
  let pose = frame.getViewerPose(refSpace);

  scene.startFrame();

  session.requestAnimationFrame(onXRFrame);

  updateInputSources(session, frame, refSpace);

  scene.drawXRFrame(frame, pose);

  scene.endFrame();
}

// Start the XR application.
