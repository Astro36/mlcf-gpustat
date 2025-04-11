/** @type {import('vite').UserConfig} */
import { minify } from "html-minifier-terser";
import tailwindcss from "@tailwindcss/vite";

const htmlPlugin = () => {
  return {
    name: "html-transform",
    async transformIndexHtml(html) {
      const htmlMinified = await minify(html, { collapseWhitespace: true });
      return htmlMinified;
    },
  };
};

export default {
  plugins: [tailwindcss(), htmlPlugin()],
};
