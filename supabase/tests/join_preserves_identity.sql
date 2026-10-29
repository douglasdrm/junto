begin;
do $$
declare owner_id uuid; guest_id uuid; g uuid:=gen_random_uuid(); t uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); token text; doc jsonb; result jsonb;
begin
 select id into owner_id from auth.users where not coalesce(is_anonymous,false) and email_confirmed_at is not null order by created_at limit 1;
 select id into guest_id from auth.users where not coalesce(is_anonymous,false) and email_confirmed_at is not null and id<>owner_id order by created_at limit 1;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.travel_groups(id,owner_id,name) values(g,owner_id,'Temporary join identity test');
 insert into public.trips(id,group_id,organizer_id,name) values(t,g,owner_id,'Temporary join identity test');
 insert into public.trip_access(trip_id,profile_id,role,granted_by) values(t,owner_id,'organizer',owner_id);
 insert into public.group_members(id,group_id,display_name,local_source_id,created_by) values(m,g,'Guest fixture','member-original',owner_id);
 insert into public.trip_participants(id,trip_id,member_id,contributes,settings,local_source_id) values(p,t,m,false,'{"customTargetCents":12345}','person-original');
 insert into public.member_profile_links(member_id,profile_id,status,authorized_by) values(m,guest_id,'active',owner_id);
 insert into public.trip_snapshots(trip_id,payload,revision,updated_by) values(t,'{"trip":{"id":"local-trip"},"group":{"id":"local-group"},"members":[{"id":"member-original","name":"Guest fixture","groupId":"local-group","classification":"adult"}],"people":[{"id":"person-original","memberId":"member-original","name":"Guest fixture","contributes":false,"customTargetCents":12345}],"payments":[{"id":"fixture-payment","amountCents":500,"participantIds":["person-original"]}]}',1,owner_id);
 token:=public.create_trip_join_link(t);
 perform set_config('request.jwt.claim.sub',guest_id::text,true);
 result:=public.accept_trip_join_link(token,'Guest fixture',null);
 select payload into doc from public.trip_snapshots where trip_id=t;
 if jsonb_array_length(doc->'people')<>1 or jsonb_array_length(doc->'members')<>1 then raise exception 'duplicate snapshot records';end if;
 if doc->'people'->0->>'id'<>'person-original' or doc->'people'->0->>'memberId'<>'member-original' then raise exception 'original identity lost';end if;
 if (doc->'people'->0->>'customTargetCents')::int<>12345 or (doc->'people'->0->>'contributes')::boolean then raise exception 'financial settings changed';end if;
 if (select local_source_id from public.trip_participants where id=p)<>'person-original' or (select contributes from public.trip_participants where id=p) then raise exception 'participant metadata changed';end if;
 if doc->'members'->0->>'classification'<>'adult' then raise exception 'member metadata lost';end if;
 if doc->'payments'<>'[{"id":"fixture-payment","amountCents":500,"participantIds":["person-original"]}]'::jsonb then raise exception 'payments changed';end if;
 perform public.accept_trip_join_link(token,'Guest fixture',null);
 if (select count(*) from public.trip_participants where trip_id=t)<>1 then raise exception 'repeat acceptance duplicated participant';end if;
end $$;
rollback;
