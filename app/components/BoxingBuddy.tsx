import {useEffect, useRef, useState} from 'react';
import type * as ThreeTypes from 'three';

const MODEL_URL = '/models/boxing/basic/boxing-boy-rig.glb';
const FALLBACK_BASECOLOR = '/models/boxing/basic/boxing-boy-rig-basecolor.png';
const CLOSED_BASECOLOR = '/models/boxing/basic/boxing-boy-rig-basecolor-blink.png';
const FALLBACK_NORMAL = '/models/boxing/basic/boxing-boy-rig-normal.png';
const MOVE_ANIMS = [
  {key: 'punch', url: '/models/boxing/animations/punch-combo.glb'},
  {key: 'kick', url: '/models/boxing/animations/mma-kick.glb'},
];
const IDLE_URL = '/models/boxing/animations/idle.glb';
const BLEND_TIME = 0.18;

/**
 * Mixamo bone names carry a "mixamorig:" prefix in the rig, but that colon is
 * lost when a skeleton-only FBX is round-tripped to GLB. Match bones on a
 * case-insensitive, separator-free key so both sides line up.
 */
const boneKey = (name: string) => name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

/**
 * BoxingBuddy
 * A small three.js mascot pinned to the bottom-right corner of every page.
 * Plays a Mixamo idle loop from a skinless animation GLB retargeted onto the
 * character by direct bone-local-transform copying (both rigs share the same
 * Mixamo bone names up to separators).
 *
 * GLB rather than FBX: Oxygen does not serve .fbx static assets at all
 * (requests 404 even though the file is committed and present in the build),
 * while .glb is served normally.
 *
 * Interaction:
 *  - initial: idle loop + "HIT ME" taunt
 *  - clicks cycle moves globally: punch -> kick -> punch -> kick ... The
 *    counter persists across pointer leaves, so the next click always plays
 *    the next move in the cycle.
 *  - pointer leaves: the active move always plays out to the end, then the
 *    character blends back to idle + taunt. Moves are never cut short.
 */
export function BoxingBuddy() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [taunt, setTaunt] = useState(false);

  useEffect(() => {
    let disposed = false;
    let cleanup: () => void = () => {};

    (async () => {
      const THREE = await import('three');
      const {GLTFLoader} = await import('three/examples/jsm/loaders/GLTFLoader.js');
      if (disposed) return;

      const container = containerRef.current;
      if (!container) return;

      // ---------- renderer / scene ----------
      const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.cursor = 'pointer';
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x23232b, 1.6));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
      keyLight.position.set(2.5, 4, 3.5);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0xe10600, 1.4);
      rimLight.position.set(-3, 2, -3);
      scene.add(rimLight);

      // ---------- character ----------
      // Load fallback textures in parallel with the model — the GLB's
      // embedded texture blobs intermittently fail to decode (GLTFLoader
      // then silently sets map/normalMap = null).
      const [gltf, fallbackTex, fallbackNormal, closedTex] = await Promise.all([
        new GLTFLoader().loadAsync(MODEL_URL),
        new THREE.TextureLoader().loadAsync(FALLBACK_BASECOLOR).catch(() => null),
        new THREE.TextureLoader().loadAsync(FALLBACK_NORMAL).catch(() => null),
        new THREE.TextureLoader().loadAsync(CLOSED_BASECOLOR).catch(() => null),
      ]);
      if (disposed) return;
      if (fallbackTex) {
        fallbackTex.colorSpace = THREE.SRGBColorSpace;
        fallbackTex.flipY = false; // glTF UV convention
      }
      if (closedTex) {
        closedTex.colorSpace = THREE.SRGBColorSpace;
        closedTex.flipY = false;
      }
      if (fallbackNormal) {
        fallbackNormal.flipY = false; // stays linear (NoColorSpace)
      }
      const charRoot = gltf.scene;

      let skinned: any = null;
      charRoot.traverse((o: any) => {
        if (o.isSkinnedMesh && !skinned) skinned = o;
        if (o.isMesh) {
          o.castShadow = false;
          o.frustumCulled = false;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m: any) => {
            // The GLB exports alphaMode: BLEND with garbage data in the
            // texture's alpha channel — renders as black blotches/cracks.
            // Force fully opaque rendering.
            m.transparent = false;
            m.alphaTest = 0;
            m.depthWrite = true;
            m.side = THREE.FrontSide;
            if (!m.map && fallbackTex) {
              m.map = fallbackTex;
            }
            if (!m.normalMap && fallbackNormal) {
              m.normalMap = fallbackNormal;
              m.normalScale = new THREE.Vector2(0.8, 0.8);
            }
            if (m.map) {
              m.map.colorSpace = THREE.SRGBColorSpace;
            }
            m.needsUpdate = true;
          });
        }
      });
      if (!skinned) throw new Error('BoxingBuddy: character has no skin');

      // Blink: the eyes are painted into the base color texture, so blinking
      // is done by briefly swapping in a "closed eyes" texture variant
      // (generated offline by painting skin over the eyes + a lash line).
      // Much cleaner than geometry morphing on this coarse auto-generated
      // topology. Collect the unique materials that carry the base color.
      const mats: any[] = [];
      charRoot.traverse((o: any) => {
        const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of list) {
          if (m.map && !mats.includes(m)) mats.push(m);
        }
      });
      const openTex: any = mats[0]?.map ?? null;

      // Capture the target rig's rest pose BEFORE any animation is applied.
      // Retarget math: q_target = q_src * (q_srcRest⁻¹ * q_targetRest), i.e.
      // apply the source's rotation *delta* on top of the target's own rest
      // pose instead of naively copying absolute rotations (which distorts
      // whenever the two rigs' rest orientations differ).
      const tgtRestQ = new Map<any, ThreeTypes.Quaternion>();
      const tgtRestP = new Map<any, ThreeTypes.Vector3>();
      for (const b of skinned.skeleton.bones) {
        tgtRestQ.set(b, b.quaternion.clone());
        tgtRestP.set(b, b.position.clone());
      }

      // The exported Armature node carries a +90°X rotation (Mixamo FBX
      // convention) that makes the character lie face-down — compensate on
      // the scene root. Skinning survives this because the transform is
      // rigid and applied above the whole bind hierarchy.
      charRoot.rotation.x = -Math.PI / 2;
      charRoot.updateMatrixWorld(true);
      scene.add(charRoot);

      // ---------- framing (camera only — never transform the character) ----------
      const boneBox = new THREE.Box3();
      const wp = new THREE.Vector3();
      for (const b of skinned.skeleton.bones) {
        boneBox.expandByPoint(b.getWorldPosition(wp));
      }
      const boxSize = boneBox.getSize(new THREE.Vector3());
      const boxCenter = boneBox.getCenter(new THREE.Vector3());
      const viewHeight = boxSize.y * 1.12;
      const dist = viewHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) + 0.25;
      camera.position.set(0.22, boxCenter.y + 0.02, dist);
      camera.lookAt(0, boxCenter.y, 0);

      // soft contact shadow under the feet
      const shadowCanvas = document.createElement('canvas');
      shadowCanvas.width = shadowCanvas.height = 128;
      const sctx = shadowCanvas.getContext('2d')!;
      const grad = sctx.createRadialGradient(64, 64, 8, 64, 64, 64);
      grad.addColorStop(0, 'rgba(0,0,0,0.42)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, 128, 128);
      const shadowTex = new THREE.CanvasTexture(shadowCanvas);
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(boxSize.x * 1.15, boxSize.x * 1.15),
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          depthWrite: false,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.002;
      scene.add(shadow);

      // ---------- animation entries (skeleton-only GLB) ----------
      type Pair = {
        tb: any;
        sb: any;
        withPos: boolean;
        // constant: q_srcRest⁻¹ * q_targetRest — converts the source bone's
        // local rotation into the target bone's rest-relative rotation
        R0: ThreeTypes.Quaternion;
        restTbP: ThreeTypes.Vector3;
        restSbP: ThreeTypes.Vector3;
      };
      type Entry = {
        key: string;
        once: boolean;
        mixer: any;
        action: any;
        pairs: Pair[];
        posScale: number;
      };
      const entries = new Map<string, Entry>();

      const tmpV = new THREE.Vector3();

      const buildEntry = async (key: string, url: string, once: boolean) => {
        const gltf = await new GLTFLoader().loadAsync(url);
        const clip = gltf.animations[0];
        if (!clip) throw new Error(`BoxingBuddy: no clip in ${url}`);
        const srcRoot = gltf.scene;

        const posAnimated = new Set<string>();
        for (const t of clip.tracks) {
          if (t.name.endsWith('.position')) {
            posAnimated.add(boneKey(t.name.replace('.position', '')));
          }
        }

        // An animation-only GLB has no skinned mesh, so its nodes import as
        // plain Object3D — never Bone. Collect every named node instead of
        // filtering on o.isBone, otherwise nothing matches and the retarget
        // silently produces a frozen character.
        const srcBones = new Map<string, any>();
        srcRoot.traverse((o: any) => {
          if (o.name) srcBones.set(boneKey(o.name), o);
        });

        // capture the source rig's rest pose before the mixer advances it
        const srcRestQ = new Map<string, ThreeTypes.Quaternion>();
        const srcRestP = new Map<string, ThreeTypes.Vector3>();
        for (const [name, sb] of srcBones) {
          srcRestQ.set(name, sb.quaternion.clone());
          srcRestP.set(name, sb.position.clone());
        }

        // rescale authored hips positions from the Mixamo rig units to this
        // character's skeleton height
        srcRoot.updateMatrixWorld(true);
        const srcBox = new THREE.Box3();
        const sp = new THREE.Vector3();
        for (const b of srcBones.values()) srcBox.expandByPoint(b.getWorldPosition(sp));
        const posScale = boxSize.y / srcBox.getSize(new THREE.Vector3()).y;

        const pairs: Pair[] = [];
        for (const tb of skinned.skeleton.bones) {
          const k = boneKey(tb.name);
          const sb = srcBones.get(k);
          if (!sb) continue;
          pairs.push({
            tb,
            sb,
            withPos: posAnimated.has(k),
            R0: srcRestQ.get(k)!
              .clone()
              .invert()
              .multiply(tgtRestQ.get(tb)!),
            restTbP: tgtRestP.get(tb)!,
            restSbP: srcRestP.get(k)!,
          });
        }

        const mixer = new THREE.AnimationMixer(srcRoot);
        const action = mixer.clipAction(clip);
        const entry: Entry = {key, once, mixer, action, pairs, posScale};
        entry.mixer.addEventListener('finished', () => {
          if (activeKey === key) {
            // a one-shot move completed — blend back to idle and restore
            // the taunt (also covers "pointer left mid-move" cases, since
            // leaving never interrupts a playing move)
            transitionTo('idle', false);
            setTaunt(true);
          }
        });
        entries.set(key, entry);
        return entry;
      };

      const applyPose = (entry: Entry) => {
        for (const p of entry.pairs) {
          // rest-relative retarget: apply source delta onto target rest pose
          p.tb.quaternion.copy(p.sb.quaternion).multiply(p.R0);
          if (p.withPos) {
            p.tb.position
              .copy(p.restTbP)
              .addScaledVector(
                tmpV.copy(p.sb.position).sub(p.restSbP),
                entry.posScale,
              );
          }
        }
      };

      // ---------- blending ----------
      type Blend = {from: Entry; to: Entry; t: number};
      let blending: Blend | null = null;
      const poseQ: Array<ThreeTypes.Quaternion> = [];
      const poseP: Array<ThreeTypes.Vector3> = [];

      // capture the entry's current animated pose (computed from the SOURCE
      // skeleton via rest-relative retarget — the mixer has just advanced it)
      const capturePose = (entry: Entry) => {
        entry.pairs.forEach((p, i) => {
          if (!poseQ[i]) poseQ[i] = new THREE.Quaternion();
          poseQ[i].copy(p.sb.quaternion).multiply(p.R0);
          if (p.withPos) {
            if (!poseP[i]) poseP[i] = new THREE.Vector3();
            poseP[i]
              .copy(p.restTbP)
              .addScaledVector(
                tmpV.copy(p.sb.position).sub(p.restSbP),
                entry.posScale,
              );
          }
        });
      };

      let activeKey: string | null = null;
      const transitionTo = (key: string, once: boolean) => {
        const to = entries.get(key);
        if (!to) return;
        to.action.reset();
        to.action.setLoop(
          once ? THREE.LoopOnce : THREE.LoopRepeat,
          once ? 1 : Infinity,
        );
        to.action.clampWhenFinished = once;
        to.action.play();
        if (activeKey && activeKey !== key) {
          const from = entries.get(activeKey);
          if (from) {
            capturePose(from);
            blending = {from, to, t: 0};
          }
        }
        activeKey = key;
      };

      // ---------- interaction state machine ----------
      // The move counter is global: it survives pointer leaves, so moves
      // always alternate punch -> kick -> punch ... regardless of how often
      // the cursor enters or leaves. Leaving mid-move does nothing here —
      // the 'finished' handler above returns to idle when the move ends.
      let step = 0; // next move index (0 -> punch, 1 -> kick, ...)
      const controller = {
        hit() {
          const move = MOVE_ANIMS[step % MOVE_ANIMS.length];
          step += 1;
          setTaunt(false);
          transitionTo(move.key, true);
        },
      };

      const onPointerDown = (e: PointerEvent) => {
        e.preventDefault();
        controller.hit();
      };
      renderer.domElement.addEventListener('pointerdown', onPointerDown);

      await buildEntry('idle', IDLE_URL, false);
      for (const m of MOVE_ANIMS) {
        await buildEntry(m.key, m.url, true);
      }
      if (disposed) return;
      transitionTo('idle', false);
      setReady(true);
      setTaunt(true);

      // ---------- resize ----------
      const resize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(container);

      // ---------- loop ----------
      const clock = new THREE.Clock();
      // blink scheduler: random 2–4.5 s interval; eyes stay shut for the
      // middle ~65% of the 0.3 s blink — a real blink has no tweening
      const BLINK_DUR = 0.3;
      let blinkDur = BLINK_DUR;
      let blinkT = -1;
      let nextBlink = 2;
      let elapsed = 0;
      let lastBlinkAt = -1;
      let frozen = 0;
      let eyesClosed = false;
      const setEyes = (closed: boolean) => {
        if (eyesClosed === closed || !closedTex || !openTex) return;
        eyesClosed = closed;
        const tex = closed ? closedTex : openTex;
        for (const m of mats) m.map = tex;
      };
      // debug hook (used by automated browser verification):
      // trigger() = normal blink, trigger(3) = slow-motion blink;
      // freeze(1) = hold eyes shut, freeze(0) = release;
      // lastBlinkAt = elapsed time of the most recent spontaneous blink
      (window as any).__buddyBlinkState = {
        trigger: (dur?: number) => {
          blinkT = 0;
          blinkDur = dur && dur > 0 ? dur : BLINK_DUR;
        },
        freeze: (v: number) => {
          frozen = v;
          setEyes(v > 0);
        },
        get lastBlinkAt() {
          return lastBlinkAt;
        },
        get elapsed() {
          return elapsed;
        },
        // verification aids: how many bones each clip bound, and whether the
        // rig pose is actually moving (bone-local quaternion y components)
        get diag() {
          return [...entries.values()].map((e) => ({
            key: e.key,
            once: e.once,
            pairs: e.pairs.length,
            posAnimated: e.pairs.filter((p) => p.withPos).length,
            trackList: e.action.getClip().tracks.length,
            duration: +e.action.getClip().duration.toFixed(2),
            posScale: +e.posScale.toFixed(4),
          }));
        },
        get activeKey() {
          return activeKey;
        },
        get pose() {
          return skinned.skeleton.bones.map((b: any) => b.quaternion.y);
        },
      };
      renderer.setAnimationLoop(() => {
        const dt = Math.min(clock.getDelta(), 0.05);
        elapsed += dt;
        if (!frozen && openTex && closedTex) {
          if (blinkT < 0 && elapsed >= nextBlink) {
            blinkT = 0;
            lastBlinkAt = elapsed;
          }
          if (blinkT >= 0) {
            blinkT += dt;
            const p = Math.min(blinkT / blinkDur, 1);
            setEyes(p > 0.15 && p < 0.8);
            if (p >= 1) {
              blinkT = -1;
              blinkDur = BLINK_DUR;
              nextBlink = elapsed + 2 + Math.random() * 2.5;
            }
          }
        }
        const active = activeKey ? entries.get(activeKey) : null;
        if (blending) {
          blending.from.mixer.update(dt);
          capturePose(blending.from);
          const fromQ = poseQ.map((q) => q.clone());
          const fromP = poseP.map((v) => (v ? v.clone() : null));
          blending.to.mixer.update(dt);
          capturePose(blending.to);
          const toQ = poseQ.map((q) => q.clone());
          const toP = poseP.map((v) => (v ? v.clone() : null));
          const alpha = Math.min(blending.t / BLEND_TIME, 1);
          const ease = alpha * alpha * (3 - 2 * alpha);
          blending.to.pairs.forEach((p, i) => {
            p.tb.quaternion.slerpQuaternions(fromQ[i], toQ[i], ease);
            if (p.withPos && fromP[i] && toP[i]) {
              p.tb.position.lerpVectors(fromP[i]!, toP[i]!, ease);
            }
          });
          blending.t += dt;
          if (alpha >= 1) {
            blending.from.action.stop();
            blending = null;
          }
        } else if (active) {
          active.mixer.update(dt);
          applyPose(active);
        }
        renderer.render(scene, camera);
      });

      cleanup = () => {
        delete (window as any).__buddyBlinkState;
        renderer.setAnimationLoop(null);
        observer.disconnect();
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        entries.forEach((e) => e.mixer.stopAllAction());
        scene.traverse((o: any) => {
          if (o.geometry) o.geometry.dispose?.();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats?.forEach?.((m: any) => {
            if (!m) return;
            m.map?.dispose?.();
            m.dispose?.();
          });
        });
        shadowTex.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })().catch((e) => {
      console.error('BoxingBuddy failed to load', e);
      if (!disposed) setFailed(true);
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div className="boxing-buddy" aria-hidden="true">
      {ready && taunt && !failed ? <span className="boxing-buddy-taunt">HIT ME 👊</span> : null}
      {!ready && !failed ? <span className="boxing-buddy-loading">🥊</span> : null}
      <div className="boxing-buddy-stage" ref={containerRef} />
    </div>
  );
}
