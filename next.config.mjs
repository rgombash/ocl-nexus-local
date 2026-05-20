/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable telemetry in production
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
};

export default nextConfig;
