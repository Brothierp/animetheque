-- Droits de la fonction « push » (rôle service_role) sur les tables qu'elle lit ou écrit.
-- Les projets Supabase récents n'accordent plus ces droits automatiquement : sans eux, la fonction
-- répond « permission denied » et aucune notification n'arrive sur les téléphones.
grant select, insert on public.notifications to service_role;
grant select, delete on public.push_subscriptions to service_role;
grant select on public.profiles to service_role;
grant select on public.messages to service_role;
