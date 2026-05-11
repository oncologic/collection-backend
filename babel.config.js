export default {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: 'current',
        },
        modules: 'auto',
      },
    ],
  ],
  plugins: [
    function () {
      return {
        visitor: {
          MetaProperty(path) {
            if (
              path.node.meta.name === 'import' &&
              path.node.property.name === 'url'
            ) {
              path.replaceWithSourceString('"file://" + __filename');
            }
          },
        },
      };
    },
  ],
};
