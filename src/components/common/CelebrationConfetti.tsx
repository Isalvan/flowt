import React, { useEffect, useRef } from 'react';

interface CelebrationConfettiProps {
  trigger: number; // Increment this to fire a burst
}

interface Particle {
  x: number;
  y: number;
  size: number;
  color: string;
  speedX: number;
  speedY: number;
  gravity: number;
  drag: number;
  rotation: number;
  rotationSpeed: number;
  wobble: number;
  wobbleSpeed: number;
}

const COLORS = [
  '#6366f1', // Indigo
  '#0ea5e9', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#f97316', // Orange
];

export const CelebrationConfetti: React.FC<CelebrationConfettiProps> = ({ trigger }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationFrameIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (trigger === 0 || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resize canvas
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const spawnParticles = () => {
      const count = 120;
      const newParticles: Particle[] = [];
      
      for (let i = 0; i < count; i++) {
        // Spawn from center-bottom or spread out slightly
        newParticles.push({
          x: canvas.width / 2 + (Math.random() - 0.5) * 40,
          y: canvas.height * 0.7,
          size: Math.random() * 8 + 5,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          speedX: (Math.random() - 0.5) * 20, // lateral force
          speedY: -Math.random() * 18 - 8,    // strong upward force
          gravity: 0.35,                      // falling down pull
          drag: 0.96,                         // friction
          rotation: Math.random() * 360,
          rotationSpeed: (Math.random() - 0.5) * 8,
          wobble: Math.random() * Math.PI,
          wobbleSpeed: Math.random() * 0.1 + 0.05,
        });
      }

      particlesRef.current = newParticles;
    };

    spawnParticles();

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const particles = particlesRef.current;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // Apply physics
        p.speedX *= p.drag;
        p.speedY *= p.drag;
        p.speedY += p.gravity;
        p.x += p.speedX;
        p.y += p.speedY;

        // Wobbling movement
        p.wobble += p.wobbleSpeed;
        p.rotation += p.rotationSpeed;

        const wobbleX = p.x + Math.sin(p.wobble) * 6;

        // Draw particle
        ctx.save();
        ctx.translate(wobbleX, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        
        // Random shapes (rectangles, squares, circles)
        if (i % 3 === 0) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (i % 3 === 1) {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size / 1.5);
        } else {
          ctx.beginPath();
          ctx.moveTo(0, -p.size / 2);
          ctx.lineTo(p.size / 2, p.size / 2);
          ctx.lineTo(-p.size / 2, p.size / 2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();

        // Remove if off screen or slow
        if (p.y > canvas.height + 20) {
          particles.splice(i, 1);
        }
      }

      if (particles.length > 0) {
        animationFrameIdRef.current = requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    animate();

    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [trigger]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-50 w-full h-full"
      style={{ mixBlendMode: 'screen' }}
    />
  );
};
