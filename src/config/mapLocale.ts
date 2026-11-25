/**
 * MapLibre's own words, in Spanish: what a screen reader says on the map's controls and on the map itself.
 * Passed as the map's `locale`, so they are right from the first paint (before, three were set by hand a frame
 * after load, and «Map» and «Toggle attribution» stayed in English).
 */
export const MAP_LOCALE: Record<string, string> = {
  'Map.Title': 'Mapa',
  'Marker.Title': 'Marcador',
  'Popup.Close': 'Cerrar',
  'NavigationControl.ZoomIn': 'Acercar',
  'NavigationControl.ZoomOut': 'Alejar',
  'NavigationControl.ResetBearing': 'Restablecer orientación norte',
  'AttributionControl.ToggleAttribution': 'Mostrar u ocultar las fuentes del mapa',
  'AttributionControl.MapFeedback': 'Comentar el mapa',
  'LogoControl.Title': 'Logotipo de MapLibre',
  'CooperativeGesturesHandler.MobileHelpText': 'Usa dos dedos para mover el mapa',
  'CooperativeGesturesHandler.WindowsHelpText': 'Usa Ctrl y la rueda para acercar el mapa',
  'CooperativeGesturesHandler.MacHelpText': 'Usa ⌘ y la rueda para acercar el mapa',
};
