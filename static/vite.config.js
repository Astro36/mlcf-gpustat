/** @type {import('vite').UserConfig} */
import { minify } from "html-minifier-terser";

const htmlPlugin = () => {
  return {
    name: "html-transform",
    async transformIndexHtml(html) {
      const htmlMinified = await minify(html, {
        collapseWhitespace: true,
      });
      return htmlMinified;
    },
  };
};

export default {
  plugins: [htmlPlugin()],
};
