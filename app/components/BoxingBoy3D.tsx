import {useEffect, useRef, useState} from 'react';

/**
 * Hero model URL. Exported so the homepage route can preload it during HTML
 * parse — it is the largest above-the-fold asset and would otherwise not be
 * requested until the JS bundle *and* the lazily imported three.js chunk had
 * both executed. The `?v=` suffix busts Oxygen's year-long asset cache.
 */
export const HERO_MODEL_URL = '/models/jab-cross.glb?v=2';

/**
 * Bundled fallbacks used only when the GLB's embedded textures fail to decode.
 * Small enough not to matter, and never fetched on the happy path.
 */
const FALLBACK_BASECOLOR = '/models/boxing-basecolor.jpg';
const FALLBACK_NORMAL = '/models/boxing-normal.jpg';

/**
 * BoxingBoy3D
 * Client-only three.js viewer that loads the hero GLB, plays its embedded
 * animation, auto-rotates slowly and renders the model centered in a
 * fullscreen hero canvas.
 */
export function BoxingBoy3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const THREE = await import('three');
      const {GLTFLoader} = await import('three/examples/jsm/loaders/GLTFLoader.js');
      if (disposed || !containerRef.current) return;

      // ---------- Renderer ----------
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      container.appendChild(renderer.domElement);

      // ---------- Scene / Camera ----------
      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x0c0c0f, 8, 22);

      const camera = new THREE.PerspectiveCamera(
        38,
        container.clientWidth / container.clientHeight,
        0.1,
        100,
      );
      camera.position.set(0, 1.6, 6.2);
      camera.lookAt(0, 1.1, 0);

      // ---------- Lights ----------
      // Keep total intensity moderate — strong stacked lights wash the
      // baseColor texture out to gray-white (overexposure).
      scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1a20, 0.55));

      const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
      keyLight.position.set(4, 6, 4);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(2048, 2048);
      keyLight.shadow.camera.near = 0.5;
      keyLight.shadow.camera.far = 20;
      keyLight.shadow.camera.left = -5;
      keyLight.shadow.camera.right = 5;
      keyLight.shadow.camera.top = 5;
      keyLight.shadow.camera.bottom = -5;
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0xe10600, 1.3);
      rimLight.position.set(-5, 3, -4);
      scene.add(rimLight);

      const fillLight = new THREE.PointLight(0xffb45e, 0.5, 15);
      fillLight.position.set(0, 2.5, 3.5);
      scene.add(fillLight);

      // ---------- Shadow catcher ----------
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(3.2, 64),
        new THREE.ShadowMaterial({opacity: 0.45}),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);

      // ---------- Load model ----------
      const group = new THREE.Group();
      scene.add(group);

      const mixerHolder: {mixer: InstanceType<typeof THREE.AnimationMixer> | null} = {
        mixer: null,
      };

      const loader = new GLTFLoader();
      loader.load(
        HERO_MODEL_URL,
        async (gltf) => {
          if (disposed) return;
          const model = gltf.scene;

          // If the GLB's embedded textures fail to decode (blob decode is
          // occasionally rejected for huge 4K PNGs), fall back to the bundled
          // image files so the fighter never renders as a gray silhouette.
          const brokenMap: Array<InstanceType<typeof THREE.Material> & {map?: InstanceType<typeof THREE.Texture> | null}> = [];
          const brokenNormal: Array<InstanceType<typeof THREE.Material> & {normalMap?: InstanceType<typeof THREE.Texture> | null}> = [];

          model.traverse((child) => {
            const mesh = child as InstanceType<typeof THREE.Mesh>;
            // The GLB ships a leftover untextured placeholder cube — hide it
            if (child.name === 'Cube') {
              child.visible = false;
              return;
            }
            if (mesh.isMesh) {
              mesh.castShadow = true;
              mesh.receiveShadow = false;
              const material = mesh.material as
                | (InstanceType<typeof THREE.Material> & {
                    map?: InstanceType<typeof THREE.Texture>;
                    normalMap?: InstanceType<typeof THREE.Texture>;
                  })
                | Array<InstanceType<typeof THREE.Material> & {
                    map?: InstanceType<typeof THREE.Texture>;
                    normalMap?: InstanceType<typeof THREE.Texture>;
                  }>;
              const fixMap = (
                m: InstanceType<typeof THREE.Material> & {
                  map?: InstanceType<typeof THREE.Texture> | null;
                  normalMap?: InstanceType<typeof THREE.Texture> | null;
                },
              ) => {
                // GLTFLoader sets failed textures to *null* (not an empty
                // texture), so a missing map on a visible mesh means the
                // embedded texture blob failed to decode.
                if (m.map && m.map.image) {
                  m.map.colorSpace = THREE.SRGBColorSpace;
                  m.map.needsUpdate = true;
                } else {
                  brokenMap.push(m);
                }
                if (!m.normalMap) brokenNormal.push(m);
              };
              if (Array.isArray(material)) {
                material.forEach(fixMap);
              } else {
                fixMap(material);
              }
            }
          });

          // If the GLB's embedded textures failed to decode (GLTFLoader leaves
          // map/normalMap null rather than throwing), fetch the bundled
          // fallbacks — and finish applying them BEFORE flipping `ready`.
          // Previously the model was revealed first and the textures arrived a
          // couple of seconds later, so the fighter sat there as a flat gray
          // silhouette. Now the loading overlay covers that window instead.
          const texLoader = new THREE.TextureLoader();
          const [fallbackMap, fallbackNormalMap] = await Promise.all([
            brokenMap.length > 0
              ? texLoader.loadAsync(FALLBACK_BASECOLOR).catch(() => null)
              : Promise.resolve(null),
            brokenNormal.length > 0
              ? texLoader.loadAsync(FALLBACK_NORMAL).catch(() => null)
              : Promise.resolve(null),
          ]);
          if (disposed) return;
          if (fallbackMap) {
            fallbackMap.colorSpace = THREE.SRGBColorSpace;
            fallbackMap.flipY = false; // glTF UV convention
            brokenMap.forEach((m) => {
              m.map = fallbackMap;
              m.needsUpdate = true;
            });
          }
          if (fallbackNormalMap) {
            fallbackNormalMap.flipY = false;
            brokenNormal.forEach((m) => {
              m.normalMap = fallbackNormalMap;
              m.needsUpdate = true;
            });
          }

          // Center + scale the model to fit the stage.
          // Skinned meshes have a tiny bind-pose bounding box, so compute a
          // world-space box from the *skinned* geometry instead of Box3.setFromObject.
          model.updateMatrixWorld(true);
          const box = new THREE.Box3();
          const tmpBox = new THREE.Box3();
          let hasBox = false;
          model.traverse((obj) => {
            if (!obj.visible) return;
            const skinned = obj as InstanceType<typeof THREE.SkinnedMesh>;
            const mesh = obj as InstanceType<typeof THREE.Mesh>;
            if (skinned.isSkinnedMesh && skinned.boundingBox === null) {
              skinned.computeBoundingBox();
            }
            if (mesh.isMesh) {
              if (skinned.isSkinnedMesh && skinned.boundingBox) {
                // skinned bbox is in mesh-local units (cm) — map to world space
                tmpBox.copy(skinned.boundingBox).applyMatrix4(mesh.matrixWorld);
                box.union(tmpBox);
              } else {
                box.expandByObject(mesh);
              }
              hasBox = true;
            }
          });
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = hasBox && maxDim > 0 ? 2.1 / maxDim : 1;
          model.scale.setScalar(scale);
          model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
          // Nudge the fighter down-left so the headline stays readable
          model.position.x -= 0.55;
          model.position.y -= 0.25;

          group.add(model);

          // Play embedded animation clips
          if (gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(model);
            for (const clip of gltf.animations) {
              mixer.clipAction(clip).play();
            }
            mixerHolder.mixer = mixer;
          }
          setReady(true);
        },
        (event) => {
          if (event.total > 0) {
            setProgress(Math.round((event.loaded / event.total) * 100));
          }
        },
        (error) => {
          console.error('Failed to load jab-cross.glb', error);
          setFailed(true);
        },
      );

      // ---------- Render loop ----------
      const clock = new THREE.Clock();
      let frameId = 0;
      const animate = () => {
        frameId = requestAnimationFrame(animate);
        const delta = clock.getDelta();
        mixerHolder.mixer?.update(delta);
        group.rotation.y += delta * 0.35; // slow stage rotation
        renderer.render(scene, camera);
      };
      animate();

      // ---------- Resize ----------
      const onResize = () => {
        if (!containerRef.current) return;
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      window.addEventListener('resize', onResize);

      cleanup = () => {
        cancelAnimationFrame(frameId);
        window.removeEventListener('resize', onResize);
        mixerHolder.mixer?.stopAllAction();
        renderer.dispose();
        scene.traverse((obj) => {
          const mesh = obj as InstanceType<typeof THREE.Mesh>;
          if (mesh.isMesh) {
            mesh.geometry?.dispose();
            const material = mesh.material as
              | InstanceType<typeof THREE.Material>
              | InstanceType<typeof THREE.Material>[];
            if (Array.isArray(material)) {
              material.forEach((m) => m.dispose());
            } else {
              material?.dispose();
            }
          }
        });
        if (renderer.domElement.parentElement === container) {
          container.removeChild(renderer.domElement);
        }
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className="boxing-3d-stage" ref={containerRef}>
      {!ready && !failed && (
        <div className="boxing-3d-loader">
          <div className="boxing-3d-loader-glove">🥊</div>
          <div className="boxing-3d-loader-bar">
            <div
              className="boxing-3d-loader-fill"
              style={{width: `${progress}%`}}
            />
          </div>
          <span className="boxing-3d-loader-text">
            Loading fighter… {progress}%
          </span>
        </div>
      )}
      {failed && (
        <div className="boxing-3d-loader">
          <span className="boxing-3d-loader-text">
            3D model failed to load.
          </span>
        </div>
      )}
    </div>
  );
}
