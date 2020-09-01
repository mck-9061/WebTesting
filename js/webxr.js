import {WebXRButton} from './webxr-render/util/webxr-button.js';
import {Scene} from './webxr-render/render/scenes/scene.js';
import {Renderer, createWebGLContext} from './webxr-render/render/core/renderer.js';
import {Node} from './webxr-render/render/core/node.js';
import {Gltf2Node} from './webxr-render/render/nodes/gltf2.js';
import {SkyboxNode} from './webxr-render/render/nodes/skybox.js';
import {BoxBuilder} from './webxr-render/render/geometry/box-builder.js';
import {PbrMaterial} from './webxr-render/render/materials/pbr.js';
import {mat4, vec3, quat} from './webxr-render/render/math/gl-matrix.js';
import {QueryArgs} from './webxr-render/util/query-args.js';

// If requested, don't display the frame rate info.
let hideStats = false
if (document.getElementById("boxes").options[document.getElementById("boxes").selectedIndex].text == "no") hideStats = true

// XR globals. Several additional reference spaces are required because of
// how the teleportation mechanic in onSelect works.
let xrButton = null;
let xrImmersiveRefSpaceBase = null;
let xrImmersiveRefSpaceOffset = null;
let xrInlineRefSpaceBase = null;
let xrInlineRefSpaceOffset = null;
let xrViewerSpaces = {};

let trackingSpaceOriginInWorldSpace = vec3.create();
let trackingSpaceHeadingDegrees = 0;  // around +Y axis, positive angles rotate left
let floorSize = 10;
let floorPosition = [0, -floorSize / 2 + 0.01, 0];
let floorNode = null;

// WebGL scene globals.
let gl = null;
let renderer = null;
let scene = new Scene();

let currentEnvironment = null;
let currentSkybox = null;
if (hideStats) {
  scene.enableStats(false);
  scene.standingStats(false);
} else {
  scene.standingStats(true);
}

let boxes = [];
let environments = ['camp', 'cave', 'cube-room', 'garage', 'home-theater', 'space'];
let envIter = 0;
let skyboxes = ['chess-pano-4k.jpg', 'eilenriede-park-2k.png', 'milky-way-2k.png']
let skyboxIter = 0;

export function initXR(environment, skybox) {
  currentEnvironment = new Gltf2Node({url: 'media/webxr/gltf/'+environment+'/'+environment+'.gltf'})
  currentSkybox = new SkyboxNode({url: 'media/webxr/textures/'+skybox})
  scene.addNode(currentEnvironment);
  scene.addNode(currentSkybox);

  envIter = environments.indexOf(environment)
  skyboxIter = skyboxes.indexOf(skybox)

  xrButton = new WebXRButton({
    onRequestSession: onRequestSession,
    onEndSession: onEndSession
  });
  document.querySelectorAll('div')[3].appendChild(xrButton.domElement);

  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
      xrButton.enabled = supported;
      if (!supported) {
        document.getElementById("xr-remind").innerHTML = "Your browser supports WebXR but not immersive VR. Please open on a VR headset."
        document.getElementById("selectors").hidden = true
        document.getElementById("webxr-button-1").hidden = true
      }
    });
  } else {
    document.getElementById("xr-remind").innerHTML = "Your browser doesn't support WebXR. Please open on a VR headset."
    document.getElementById("selectors").hidden = true
    document.getElementById("webxr-button-1").hidden = true
  }
}



function addBox(x, y, z, r, g, b, box_list) {
  let boxBuilder = new BoxBuilder();
  boxBuilder.pushCube([0, 0, 0], 0.4);
  let boxPrimitive = boxBuilder.finishPrimitive(renderer);
  let boxMaterial = new PbrMaterial();
  boxMaterial.baseColorFactor.value = [r, g, b, 1.0];
  let boxRenderPrimitive = renderer.createRenderPrimitive(boxPrimitive, boxMaterial);
  let boxNode = new Node();
  boxNode.addRenderPrimitive(boxRenderPrimitive);
  // Marks the node as one that needs to be checked when hit testing.
  boxNode.selectable = true;
  box_list.push({
    node: boxNode,
    renderPrimitive: boxRenderPrimitive,
    position: [x, y, z]
  });
  scene.addNode(boxNode);
}

function addFloorBox() {
  let boxBuilder = new BoxBuilder();
  boxBuilder.pushCube([0, 0, 0], floorSize);
  let boxPrimitive = boxBuilder.finishPrimitive(renderer);

  let boxMaterial = new PbrMaterial();
  boxMaterial.baseColorFactor.value = [0.3, 0.3, 0.3, 1.0];
  let boxRenderPrimitive = renderer.createRenderPrimitive(boxPrimitive, boxMaterial);

  currentEnvironment.selectable = true;
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
  //addBox(-1.0, 1.6, -1.3, 1.0, 0.0, 0.0, boxes);
  //addBox(0.0, 1.7, -1.5, 0.0, 1.0, 0.0, boxes);
  //addBox(1.0, 1.6, -1.3, 0.0, 0.0, 1.0, boxes);

  // Represent the floor as a box so that we can perform a hit test
  // against it onSelect so that we can teleport the user to that
  // particular location.
  addFloorBox();
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

  // By listening for the 'select' event we can find out when the user has
  // performed some sort of primary input action and respond to it.
  session.addEventListener('select', onSelect);
  session.addEventListener('squeeze', onSqueeze);

  initGL();
  scene.inputRenderer.useProfileControllerMeshes(session);

  let glLayer = new XRWebGLLayer(session, gl);
  session.updateRenderState({ baseLayer: glLayer });

  session.requestReferenceSpace('local-floor').then((refSpace) => {
    console.log("created local-floor reference space");
    return refSpace;
  }, (e) => {
    if (!session.isImmersive) {
      // If we're in inline mode, our underlying platform may not support
      // the local-floor reference space, but a viewer space is guaranteed.
      console.log("falling back to viewer reference space");
      return session.requestReferenceSpace('viewer').then((viewerRefSpace) => {
        // Adjust the viewer space for an estimated user height. Otherwise,
        // the poses queried with this space will originate from the floor.
        let xform = new XRRigidTransform({x: 0, y: -1.5, z: 0});
        return viewerRefSpace.getOffsetReferenceSpace(xform);
      });
    } else {
      throw e;
    }
  }).then((refSpace) => {
    // Save the session-specific base reference space, and apply the current
    // player orientation/position as originOffset. This reference space
    // won't change for the duration of the session and is used when
    // updating the player position and/or orientation in onSelect.
    setRefSpace(session, refSpace, false);
    updateOriginOffset(session);

    session.requestReferenceSpace('viewer').then(function(viewerSpace){
      // Save a separate reference space that represents the tracking space
      // origin, which does not change for the duration of the session.
      // This is used when updating the player position and/or orientation
      // in onSelect.
      xrViewerSpaces[session.mode] = viewerSpace;
      session.requestAnimationFrame(onXRFrame);
    });
  });
}

// Used for updating the origin offset.
let playerInWorldSpaceOld = vec3.create();
let playerInWorldSpaceNew = vec3.create();
let playerOffsetInWorldSpaceOld = vec3.create();
let playerOffsetInWorldSpaceNew = vec3.create();
let rotationDeltaQuat = quat.create();
let invPosition = vec3.create();
let invOrientation = quat.create();

// oh hey I actually wrote some code of my own here
// squeeze button = iterate environment
// cus the boxes are big dumb
function onSqueeze(ev) {
  if (ev.inputSource.handedness == "left") {
    // Iterate environment
    envIter++
    if (envIter == 6) envIter = 0
    scene.removeNode(currentEnvironment)
    currentEnvironment = new Gltf2Node({url: 'media/webxr/gltf/'+environments[envIter]+'/'+environments[envIter]+'.gltf'})
    scene.addNode(currentEnvironment)
  } else {
    // Iterate skybox
    skyboxIter++
    if (skyboxIter == 3) skyboxIter = 0
    scene.removeNode(currentSkybox)
    currentSkybox = new SkyboxNode({url: 'media/webxr/textures/'+skyboxes[skyboxIter]})
    scene.addNode(currentSkybox)
  }
}

// If the user selected a point on the floor, teleport them to that
// position while keeping their orientation the same.
// Otherwise, check if one of the boxes was selected and update the
// user's orientation accordingly:
//    left box: turn left by 30 degress
//    center box: reset orientation
//    right box: turn right by 30 degrees
function onSelect(ev) {
  let session = ev.frame.session;
  let refSpace = getRefSpace(session, true);

  let headPose = ev.frame.getPose(xrViewerSpaces[session.mode], refSpace);
  if (!headPose) return;

  // Get the position offset in world space from the tracking space origin
  // to the player's feet. The headPose position is the head position in world space.
  // Subtract the tracking space origin position in world space to get a relative world space vector.
  vec3.set(playerInWorldSpaceOld, headPose.transform.position.x, 0, headPose.transform.position.z);
  vec3.sub(
    playerOffsetInWorldSpaceOld,
    playerInWorldSpaceOld,
    trackingSpaceOriginInWorldSpace);

  // based on https://github.com/immersive-web/webxr/blob/master/input-explainer.md#targeting-ray-pose
  let inputSourcePose = ev.frame.getPose(ev.inputSource.targetRaySpace, refSpace);
  if (!inputSourcePose) {
    return;
  }

  vec3.copy(playerInWorldSpaceNew, playerInWorldSpaceOld);
  let rotationDelta = 0;

  // Hit test results can change teleport position and orientation.
  let hitResult = scene.hitTest(inputSourcePose.transform);
  if (hitResult) {
    if (hitResult.node == currentEnvironment) {
      // New position uses x/z values of the hit test result, keeping y at 0 (floor level)
      playerInWorldSpaceNew[0] = hitResult.intersection[0];
      playerInWorldSpaceNew[1] = hitResult.intersection[1];
      playerInWorldSpaceNew[2] = hitResult.intersection[2];
      console.log('teleport to', playerInWorldSpaceNew);
    }
  }

  // Get the new world space offset vector from tracking space origin
  // to the player's feet, for the updated tracking space rotation.
  // Formally, this is the old world-space player offset transformed
  // into tracking space using the old originOffset's rotation component,
  // then transformed back into world space using the inverse of the
  // new originOffset. This simplifies to a rotation of the old player
  // offset by (new angle - old angle):
  //   worldOffsetNew = inv(rot_of(originoffsetNew)) * rot_of(originoffsetOld) * worldOffsetOld
  //       = inv(rotY(-angleNew)) * rotY(-angleOld) * worldOffsetOld
  //       = rotY(angleNew) * rotY(-angleOld) * worldOffsetOld
  //       = rotY(angleNew - angleOld) * worldOffsetOld
  quat.identity(rotationDeltaQuat);
  quat.rotateY(rotationDeltaQuat, rotationDeltaQuat, rotationDelta * Math.PI / 180);
  vec3.transformQuat(playerOffsetInWorldSpaceNew, playerOffsetInWorldSpaceOld, rotationDeltaQuat);
  trackingSpaceHeadingDegrees += rotationDelta;

  // Update tracking space origin so that origin + playerOffset == player location in world space
  vec3.sub(
    trackingSpaceOriginInWorldSpace,
    playerInWorldSpaceNew,
    playerOffsetInWorldSpaceNew);

  updateOriginOffset(session);
}

function updateOriginOffset(session) {
  // Compute the origin offset based on player position/orientation.
  quat.identity(invOrientation);
  quat.rotateY(invOrientation, invOrientation, -trackingSpaceHeadingDegrees * Math.PI / 180);
  vec3.negate(invPosition, trackingSpaceOriginInWorldSpace);
  vec3.transformQuat(invPosition, invPosition, invOrientation);
  let xform = new XRRigidTransform(
    {x: invPosition[0], y: invPosition[1], z: invPosition[2]},
    {x: invOrientation[0], y: invOrientation[1], z: invOrientation[2], w: invOrientation[3]});

  // Update offset reference to use a new originOffset with the teleported
  // player position and orientation.
  // This new offset needs to be applied to the base ref space.
  let refSpace = getRefSpace(session, false).getOffsetReferenceSpace(xform);
  setRefSpace(session, refSpace, true);

  console.log('teleport to', trackingSpaceOriginInWorldSpace);
}

function onEndSession(session) {
  session.end();
}

function onSessionEnded(event) {
  if (event.session.isImmersive) {
    xrButton.setSession(null);
  }
}

function getRefSpace(session, isOffset) {
  return session.isImmersive ?
    (isOffset ? xrImmersiveRefSpaceOffset : xrImmersiveRefSpaceBase) :
    (isOffset ? xrInlineRefSpaceOffset : xrInlineRefSpaceBase);
}

function setRefSpace(session, refSpace, isOffset) {
  if (session.isImmersive) {
    if (isOffset) {
      xrImmersiveRefSpaceOffset = refSpace;
    } else {
      xrImmersiveRefSpaceBase = refSpace;
    }
  } else {
    if (isOffset) {
      xrInlineRefSpaceOffset = refSpace;
    } else {
      xrInlineRefSpaceBase = refSpace;
    }
  }
}

function onXRFrame(time, frame) {
  let session = frame.session;
  let refSpace = getRefSpace(session, true);

  let pose = frame.getViewerPose(refSpace);
  scene.startFrame();
  session.requestAnimationFrame(onXRFrame);

  // Update the matrix for each box
  for (let box of boxes) {
    let node = box.node;
    mat4.identity(node.matrix);
    mat4.translate(node.matrix, node.matrix, box.position);
    mat4.rotateX(node.matrix, node.matrix, time/1000);
    mat4.rotateY(node.matrix, node.matrix, time/1500);
  }

  scene.updateInputSources(frame, refSpace);
  scene.drawXRFrame(frame, pose);
  scene.endFrame();
}
