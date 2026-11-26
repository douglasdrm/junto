-- Usuários confirmados para os testes (o Supabase real já os tem).
insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at,created_at)
select gen_random_uuid(),'user'||n||'@example.test',jsonb_build_object('display_name','Pessoa '||n),now(),now()+(n||' seconds')::interval
from generate_series(1,4) n;
