
(() => {
  "use strict";

  // HAND MAGIC — полный основной код

  const canvas = document.getElementById("particleCanvas");
  const video = document.getElementById("video");
  const status = document.getElementById("status");
  const gestureLabel = document.getElementById("gestureLabel");
  const cameraButton = document.getElementById("cameraButton");
  const fullscreenButton = document.getElementById("fullscreenButton");
  const cameraPanel = document.getElementById("cameraPanel");

  if (!canvas || !video) {
    alert("Не найдены particleCanvas или video. Проверь index.html.");
    return;
  }

  const ctx = canvas.getContext("2d");

  const SETTINGS = {
    count: 600,
    smoothing: 0.085,
    maxDpr: 1.5,
    trailLength: 90,
    cameraFps: 24
  };

  let W = 0;
  let H = 0;
  let particles = [];
  let currentGesture = "sphere";
  let candidateGesture = "";
  let gestureFrames = 0;
  let handTrail = [];
  let cameraStream = null;
  let hands = null;
  let cameraRunning = false;
  let processing = false;
  let lastFrameTime = 0;
  let lastHandTime = 0;
  let cameraVisible = true;

  const names = {
    sphere: "Открытая ладонь — сфера",
    heart: "Соединение пальцев — сердце",
    ring: "Полусжатая рука — кольцо",
    compact: "Кулак — сжатие",
    pointer: "Указательный палец — следование"
  };

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function setGesture(gesture) {
    currentGesture = gesture;

    if (gestureLabel) {
      gestureLabel.textContent = names[gesture] || gesture;
    }

    updateTargets();
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, SETTINGS.maxDpr);

    W = window.innerWidth;
    H = window.innerHeight;

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    updateTargets();
  }

  function random(min, max) {
    return Math.random() * (max - min) + min;
  }

  function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function createParticles() {
    particles = [];

    for (let i = 0; i < SETTINGS.count; i++) {
      particles.push({
        x: random(0, W),
        y: random(0, H),
        tx: W / 2,
        ty: H / 2,
        vx: 0,
        vy: 0,
        size: random(1.1, 2.7),
        phase: random(0, Math.PI * 2),
        hue: random(175, 220)
      });
    }

    updateTargets();
  }

  function heartPoint(i, total) {
    const t = i / total * Math.PI * 2;

    const x = 16 * Math.pow(Math.sin(t), 3);
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);

    const scale = Math.min(W, H) * 0.024;

    return {
      x: W / 2 + x * scale,
      y: H / 2 - y * scale
    };
  }

  function ringPoint(i, total) {
    const angle = i / total * Math.PI * 2;
    const radius = Math.min(W, H) * 0.28;

    return {
      x: W / 2 + Math.cos(angle) * radius,
      y: H / 2 + Math.sin(angle) * radius
    };
  }

  function compactPoint(i, total) {
    const angle = i * 2.399963;
    const radius = Math.sqrt(i / total) * Math.min(W, H) * 0.055;

    return {
      x: W / 2 + Math.cos(angle) * radius,
      y: H / 2 + Math.sin(angle) * radius
    };
  }

  function spherePoint(i, total) {
    const angle = i * 2.399963;
    const radius = Math.sqrt((i + 0.5) / total);
    const maxRadius = Math.min(W, H) * 0.34;

    return {
      x: W / 2 + Math.cos(angle) * radius * maxRadius,
      y: H / 2 + Math.sin(angle) * radius * maxRadius
    };
  }

  function pointerPoint(i) {
    if (!handTrail.length) return spherePoint(i, particles.length);

    const index = Math.min(
      handTrail.length - 1,
      Math.floor(i / particles.length * handTrail.length)
    );

    const point = handTrail[index];
    const spread = (i % 5 - 2) * 2.5;

    return {
      x: point.x + spread,
      y: point.y + spread
    };
  }

  function getTarget(i) {
    if (currentGesture === "heart") return heartPoint(i, particles.length);
    if (currentGesture === "ring") return ringPoint(i, particles.length);
    if (currentGesture === "compact") return compactPoint(i, particles.length);
    if (currentGesture === "pointer") return pointerPoint(i);

    return spherePoint(i, particles.length);
  }

  function updateTargets() {
    for (let i = 0; i < particles.length; i++) {
      const target = getTarget(i);
      particles[i].tx = target.x;
      particles[i].ty = target.y;
    }
  }

  function isFingerUp(points, tip, pip, mcp) {
    const wrist = points[0];
    const tipDistance = distance(points[tip], wrist);
    const pipDistance = distance(points[pip], wrist);
    const mcpDistance = distance(points[mcp], wrist);

    return tipDistance > pipDistance * 1.12 &&
      tipDistance > mcpDistance * 1.3;
  }

  function detectGesture(points) {
    const palm = distance(points[0], points[9]) || 1;
    const pinch = distance(points[4], points[8]) / palm;

    if (pinch < 0.32) return "heart";

    const indexUp = isFingerUp(points, 8, 6, 5);
    const middleUp = isFingerUp(points, 12, 10, 9);
    const ringUp = isFingerUp(points, 16, 14, 13);
    const pinkyUp = isFingerUp(points, 20, 18, 17);

    const count =
      Number(indexUp) +
      Number(middleUp) +
      Number(ringUp) +
      Number(pinkyUp);

    if (indexUp && !middleUp && !ringUp && !pinkyUp) {
      return "pointer";
    }

    const curl =
      (
        distance(points[8], points[9]) +
        distance(points[12], points[9]) +
        distance(points[16], points[9]) +
        distance(points[20], points[9])
      ) / 4 / palm;

    if (count === 0 && curl < 0.75) return "compact";
    if (count <= 2) return "ring";

    return "sphere";
  }

  function stabilizeGesture(gesture) {
    if (gesture === candidateGesture) {
      gestureFrames++;
    } else {
      candidateGesture = gesture;
      gestureFrames = 1;
    }

    if (gestureFrames >= 4 && currentGesture !== gesture) {
      setGesture(gesture);
    }
  }

  function onHandResults(results) {
    const detected = results.multiHandLandmarks || [];

    if (!detected.length) return;

    lastHandTime = Date.now();

    if (detected.length >= 2) {
      stabilizeGesture("heart");
      return;
    }

    const points = detected[0];
    const gesture = detectGesture(points);

    stabilizeGesture(gesture);

    if (gesture === "pointer") {
      const tip = points[8];

      handTrail.push({
        x: (1 - tip.x) * W,
        y: tip.y * H
      });

      if (handTrail.length > SETTINGS.trailLength) {
        handTrail.shift();
      }

      updateTargets();
    } else {
      handTrail = [];
    }
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");

      script.src = url;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Не удалось загрузить: " + url));

      document.head.appendChild(script);
    });
  }

  async function loadMediaPipe() {
    setStatus("Загружаем систему распознавания рук...");

    await loadScript(
      "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"
    );

    if (typeof Hands === "undefined") {
      throw new Error("MediaPipe Hands не загрузился.");
    }

    hands = new Hands({
      locateFile: function(file) {
        return "https://cdn.jsdelivr.net/npm/@mediapipe/hands/" + file;
      }
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });

    hands.onResults(onHandResults);

    setStatus("Распознавание рук загружено.");
  }

  async function startCamera() {
    if (cameraRunning) return;

    try {
      setStatus("Подключаем камеру...");

      if (!navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia) {
        throw new Error("Браузер не поддерживает доступ к камере. Запусти через Live Server.");
      }

      await loadMediaPipe();

      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 480 },
          height: { ideal: 360 },
          frameRate: { ideal: SETTINGS.cameraFps }
        }
      });

      video.srcObject = cameraStream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;

      await video.play();

      cameraRunning = true;

      setStatus("Камера работает. Покажи руку.");

      processCamera();
    } catch (error) {
      console.error("HAND MAGIC:", error);

      setStatus("Ошибка: " + error.message);

      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
      }

      cameraRunning = false;
    }
  }

  async function processCamera() {
    if (!cameraRunning) return;

    const now = performance.now();
    const interval = 1000 / SETTINGS.cameraFps;

    if (
      !processing &&
      video.readyState >= 2 &&
      now - lastFrameTime >= interval
    ) {
      processing = true;
      lastFrameTime = now;

      try {
        await hands.send({ image: video });
      } catch (error) {
        console.error("Ошибка распознавания:", error);
      }

      processing = false;
    }

    requestAnimationFrame(processCamera);
  }

  function animate() {
    requestAnimationFrame(animate);

    ctx.fillStyle = "rgba(4, 8, 20, 0.23)";
    ctx.fillRect(0, 0, W, H);

    if (lastHandTime && Date.now() - lastHandTime > 1800) {
      if (currentGesture !== "sphere") {
        handTrail = [];
        setGesture("sphere");
      }
    }

    const time = performance.now();

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      const follow = currentGesture === "pointer" ? 0.16 : SETTINGS.smoothing;

      p.vx += (p.tx - p.x) * follow;
      p.vy += (p.ty - p.y) * follow;

      p.vx *= 0.78;
      p.vy *= 0.78;

      p.x += p.vx;
      p.y += p.vy;

      const pulse = Math.sin(time * 0.002 + p.phase) * 0.35;
      const radius = Math.max(0.6, p.size + pulse);
      const hue = p.hue + Math.sin(time * 0.0005 + p.phase) * 12;

      ctx.beginPath();
      ctx.fillStyle = "hsla(" + hue + ", 95%, 68%, 0.92)";
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (cameraButton) {
    cameraButton.addEventListener("click", function() {
      cameraVisible = !cameraVisible;

      if (cameraPanel) {
        cameraPanel.classList.toggle("hidden", !cameraVisible);
      }
    });
  }

  if (fullscreenButton) {
    fullscreenButton.addEventListener("click", function() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(console.error);
      } else {
        document.exitFullscreen();
      }
    });
  }

  window.addEventListener("resize", resize);

  resize();
  createParticles();
  animate();
  startCamera();

})();
