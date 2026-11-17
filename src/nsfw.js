// Analyse automatique des images avant l'envoi (NSFWJS, modèle MobileNetV2, exécuté dans le navigateur :
// l'image n'est envoyée à aucun service extérieur). Chargé seulement au premier envoi d'image (~4 Mo).
// C'est un premier filtre : la vérification humaine reste la règle pour les fan arts et les conversations avec un mineur.
let modelP = null;

function loadModel() {
  if (!modelP) modelP = Promise.all([import("@tensorflow/tfjs"), import("nsfwjs")])
    .then(([tf, nsfw]) => { tf.enableProdMode(); return nsfw.load("MobileNetV2"); })
    .catch(e => { modelP = null; throw e; });
  return modelP;
}

/** Probabilité (0 à 1) que l'image soit à caractère sexuel, et le détail par catégorie ; null si l'analyse est impossible. */
export async function scanImage(source) {
  try {
    const model = await loadModel();
    // l'analyse se fait sur une copie réduite (224 px suffisent au modèle)
    const bmp = source instanceof Blob ? await createImageBitmap(source) : source;
    const k = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const res = await model.classify(c, 5);
    const p = Object.fromEntries(res.map(r => [r.className, r.probability]));
    const score = (p.Porn || 0) + (p.Hentai || 0) + 0.5 * (p.Sexy || 0);
    return { score: Math.min(1, score), detail: p };
  } catch (e) {
    console.warn("analyse d'image indisponible", e);
    return null;
  }
}
/** Seuils : au-delà de BLOCK, l'image est refusée quand un mineur est concerné ; au-delà de ADULT, elle doit être marquée 18+. */
export const NSFW = { BLOCK: 0.5, ADULT: 0.6 };
