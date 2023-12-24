/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
      ignoreDuringBuilds: true,
  },
  typescript: {
      ignoreBuildErrors: true,
  },
  publicRuntimeConfig: {
      apiPath: '/api/',
      backendOrigin: process.env.NEXT_PUBLIC_BACKEND_URL,
  },
}

module.exports = nextConfig
