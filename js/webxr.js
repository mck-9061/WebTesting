import {WebXRButton} from './webxr-render/util/webxr-button.js';
import {Scene} from './webxr-render/render/scenes/scene.js';
import {Renderer, createWebGLContext} from './webxr-render/render/core/renderer.js';
import {Node} from './webxr-render/render/core/node.js';
import {Gltf2Node} from './webxr-render/render/nodes/gltf2.js';
import {SkyboxNode} from './webxr-render/render/nodes/skybox.js';
import {BoxBuilder} from './webxr-render/render/geometry/box-builder.js';
import {PbrMaterial} from './webxr-render/render/materials/pbr.js';
import {vec3, mat4} from './webxr-render/render/math/gl-matrix.js';
import {InlineViewerHelper} from './webxr-render/util/inline-viewer-helper.js';
import {Ray} from './webxr-render/render/math/ray.js';

// XR globals.
let xrButton = null;
let xrImmersiveRefSpace = null;
let inlineViewerHelper = null;

// WebGL scene globals.
let gl = null;
let renderer = null;
let scene = new Scene();
scene.standingStats(true);

let boxes = [];
let currently_selected_boxes = [null, null];
let currently_grabbed_boxes = [null, null];

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
  document.body.appendChild(gl.canvas);

  function onResize() {
    gl.canvas.width = gl.canvas.clientWidth * window.devicePixelRatio;
    gl.canvas.height = gl.canvas.clientHeight * window.devicePixelRatio;
  }
  window.addEventListener('resize', onResize);
  onResize();

  renderer = new Renderer(gl);

  scene.setRenderer(renderer);

  // Create several boxes to use for hit testing.
  let boxBuilder = new BoxBuilder();
  boxBuilder.pushCube([0, 0, 0], 0.4);
  let boxPrimitive = boxBuilder.finishPrimitive(renderer);

  function addBox(x, y, z, r, g, b) {
    let boxMaterial = new PbrMaterial();
    boxMaterial.baseColorFactor.value = [r, g, b, 1.0];
    let boxRenderPrimitive = renderer.createRenderPrimitive(boxPrimitive, boxMaterial);
    let boxNode = new Node();
    boxNode.addRenderPrimitive(boxRenderPrimitive);
    // Marks the node as one that needs to be checked when hit testing.
    boxNode.selectable = true;
    boxes.push({
      node: boxNode,
      renderPrimitive: boxRenderPrimitive,
      position: [x, y, z],
      scale: [1, 1, 1],
    });
    scene.addNode(boxNode);
  }

  addBox(-1.0, 1.6, -1.3, 1.0, 0.0, 0.0);
  addBox(0.0, 1.7, -1.5, 0.0, 1.0, 0.0);
  addBox(1.0, 1.6, -1.3, 0.0, 0.0, 1.0);
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

  session.addEventListener('selectstart', onSelectStart);
  session.addEventListener('selectend', onSelectEnd);
  // By listening for the 'select' event we can find out when the user has
  // performed some sort of primary input action and respond to it.
  session.addEventListener('select', onSelect);

  session.addEventListener('squeezestart', onSqueezeStart);
  session.addEventListener('squeezeend', onSqueezeEnd);
  session.addEventListener('squeeze', onSqueeze);

  initGL();

  // This and all future samples that visualize controllers will use this
  // convenience method to listen for changes to the active XRInputSources
  // and load the right meshes based on the profiles array.
  scene.inputRenderer.useProfileControllerMeshes(session);

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

function onSelectStart(ev) {
  console.log("selectstart " + currently_selected_boxes);
  let refSpace = ev.frame.session.isImmersive ?
    xrImmersiveRefSpace :
    inlineViewerHelper.referenceSpace;
  let targetRayPose = ev.frame.getPose(ev.inputSource.targetRaySpace, refSpace);
  if (!targetRayPose) {
    return;
  }

  let hitResult = scene.hitTest(targetRayPose.transform);
  if (hitResult) {
    // Check to see if the hit result was one of our boxes.
    for (let box of boxes) {
      if (hitResult.node == box.node) {
        let i = (ev.inputSource.handedness == "left") ? 0 : 1;
        currently_selected_boxes[i] = box;
        box.scale = [1.25, 1.25, 1.25];
        box.selected = false;
      }
    }
  }
}
function onSelectEnd(ev) {
  let i = (ev.inputSource.handedness == "left") ? 0 : 1;
  let currently_selected_box = currently_selected_boxes[i];
  console.log("selectend " + currently_selected_box);
  if (currently_selected_box != null) {
    if (currently_selected_box.selected) {
      // it is expected that the scale is 0.75 (see onSelectStart). This should make the scale 1.0
      vec3.add(currently_selected_box.scale, currently_selected_box.scale, [0.25, 0.25, 0.25]);
      currently_selected_box.selected = false;
    } else {
      // there was no 'select' event: final cube's size will be smaller.
      currently_selected_box.scale = [0.75, 0.75, 0.75];
    }
    currently_selected_boxes[i] = null;
  }
}
function onSelect(ev) {
  let i = (ev.inputSource.handedness == "left") ? 0 : 1;
  let currently_selected_box = currently_selected_boxes[i];
  console.log("select " + currently_selected_box);
  if (currently_selected_box != null) {
    // Change the box color to something random.
    let uniforms = currently_selected_box.renderPrimitive.uniforms;
    uniforms.baseColorFactor.value = [Math.random(), Math.random(), Math.random(), 1.0];
    // it is expected that the scale is 1.25 (see onSelectStart). This should make the scale 0.75
    vec3.add(currently_selected_box.scale, currently_selected_box.scale, [-0.5, -0.5, -0.5]);
    currently_selected_box.selected = true;
  }
}

function onSqueezeStart(ev) {
  console.log("squeezestart " + currently_grabbed_boxes);
  let refSpace = ev.frame.session.isImmersive ?
    xrImmersiveRefSpace :
    inlineViewerHelper.referenceSpace;
  let targetRayPose = ev.frame.getPose(ev.inputSource.targetRaySpace, refSpace);
  if (!targetRayPose) {
    return;
  }

  let hitResult = scene.hitTest(targetRayPose.transform);
  if (hitResult) {
    // Check to see if the hit result was one of our boxes.
    for (let box of boxes) {
      if (hitResult.node == box.node && !box.grabbed) {
        let i = (ev.inputSource.handedness == "left") ? 0 : 1;
        currently_grabbed_boxes[i] = box;
        box.scale = [0.1, 0.1, 0.1];
        box.originalPos = box.position;
        box.grabbed = true;
      }
    }
  }
}
function onSqueezeEnd(ev) {
  let i = (ev.inputSource.handedness == "left") ? 0 : 1;
  let currently_grabbed_box = currently_grabbed_boxes[i];
  console.log("squeezeend " + currently_grabbed_box);
  if (currently_grabbed_box != null && currently_grabbed_box.grabbed) {
    // the scale of 'grabbed' box is 0.1. Restore the original scale.
    vec3.add(currently_grabbed_box.scale, currently_grabbed_box.scale, [1, 1, 1]);
    currently_grabbed_box.position = currently_grabbed_box.originalPos;
    currently_grabbed_box.grabbed = false;
    currently_grabbed_boxes[i] = null;
  }
}
function onSqueeze(ev) {
  let i = (ev.inputSource.handedness == "left") ? 0 : 1;
  let currently_grabbed_box = currently_grabbed_boxes[i];
  console.log("squeeze " + currently_grabbed_box);
  if (currently_grabbed_box != null && currently_grabbed_box.grabbed) {
    // Change the box color to something random, so we can see that 'squeeze' was invoked.
    let uniforms = currently_grabbed_box.renderPrimitive.uniforms;
    uniforms.baseColorFactor.value = [Math.random(), Math.random(), Math.random(), 1.0];
  }
}

function onEndSession(session) {
  session.end();
}

function onSessionEnded(event) {
  if (event.session.isImmersive) {
    xrButton.setSession(null);
  }
}

function onXRFrame(time, frame) {
  let session = frame.session;
  let refSpace = session.isImmersive ?
    xrImmersiveRefSpace :
    inlineViewerHelper.referenceSpace;
  let pose = frame.getViewerPose(refSpace);

  scene.startFrame();

  session.requestAnimationFrame(onXRFrame);

  // check if we can move grabbed objects
  for (let inputSource of frame.session.inputSources) {
    let targetRayPose = frame.getPose(inputSource.targetRaySpace, refSpace);

    if (!targetRayPose) {
      continue;
    }
    let i = (inputSource.handedness == "left") ? 0 : 1;
    if (currently_grabbed_boxes[i] != null && currently_grabbed_boxes[i].grabbed) {
      let targetRay = new Ray(targetRayPose.transform.matrix);
      let grabDistance = 0.1; // 10 cm
      let grabPos = vec3.fromValues(
        targetRay.origin[0], //x
        targetRay.origin[1], //y
        targetRay.origin[2]  //z
      );
      vec3.add(grabPos, grabPos, [
        targetRay.direction[0] * grabDistance,
        targetRay.direction[1] * grabDistance + 0.06, // 6 cm up to avoid collision with a ray
        targetRay.direction[2] * grabDistance,
      ]);
      currently_grabbed_boxes[i].position = grabPos;
    }
  }

  // Update the matrix for each box
  for (let box of boxes) {
    let node = box.node;
    mat4.identity(node.matrix);
    mat4.translate(node.matrix, node.matrix, box.position);
    mat4.rotateX(node.matrix, node.matrix, time/1000);
    mat4.rotateY(node.matrix, node.matrix, time/1500);
    mat4.scale(node.matrix, node.matrix, box.scale);
  }

  // In this sample and most samples after it we'll use a helper function
  // to automatically add the right meshes for the session's input sources
  // each frame. This also does simple hit detection to position the
  // cursors correctly on the surface of selectable nodes.
  scene.updateInputSources(frame, refSpace);

  scene.drawXRFrame(frame, pose);

  scene.endFrame();
}
