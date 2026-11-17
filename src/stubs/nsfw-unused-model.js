// Les modèles NSFWJS non utilisés (InceptionV3, MobileNetV2Mid : 35 Mo) sont remplacés par ce module vide,
// pour que le site ne publie que le modèle léger MobileNetV2 (3,5 Mo, chargé seulement à l'envoi d'une image).
export const modelJson = () => Promise.reject(new Error("modèle non inclus"));
export const weightBundles = [];
