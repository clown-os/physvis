/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 物理量配色语义（与引擎 FORCE_COLORS 一致，供图表/徽标使用）
        phys: {
          gravity: '#374151', // 重力 黑
          normal: '#059669', // 弹力 绿
          friction: '#dc2626', // 摩擦 红
          tension: '#2563eb', // 拉力 蓝
          applied: '#7c3aed', // 外力 紫
          centripetal: '#ea580c', // 向心力 橙
          spring: '#0d9488', // 回复力 青
        },
      },
    },
  },
  plugins: [],
}
