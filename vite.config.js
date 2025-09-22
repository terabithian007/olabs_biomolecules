export default {
  base: './',
  build: {
      outDir: 'dist',
      rollupOptions: {
        output: {
          entryFileNames: 'js/[name]-[hash].js',
          chunkFileNames: 'js/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const ext = assetInfo.name.split('.').pop();
  
            if (ext === 'css') {
              return 'css/[name]-[hash].[ext]';
            }
            if (/(woff2?|ttf|otf|eot)$/.test(ext)) {
              return 'css/fonts/[name]-[hash].[ext]'; // Fonts inside css/fonts/
            }
            if (/\.(png|jpe?g|gif|svg|webp|avif)$/.test(assetInfo.name)) {
              return 'images/[name]-[hash].[ext]';
            }
            return 'assets/[name]-[hash].[ext]'; // fallback for any other assets
          },
        },
      },
  },
};