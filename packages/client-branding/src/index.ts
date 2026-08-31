/**
 * TRS-AIP Web Client 插件的宿主入口。浏览器端功能由 `./client` 单独导出，
 * 并通过 package.json 中的 DSH 配置被发现和加载。
 */

/** 本包只提供浏览器端的品牌展示，宿主插件无需执行逻辑。 */
export function apply(): void {}

