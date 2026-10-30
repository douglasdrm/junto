'use strict';
// Messaging crawlers read the server HTML; browsers continue to the existing app.
(()=>{
 const source=new URL(location.href),target=new URL('/',location.origin);
 const join=source.searchParams.getAll('join'),invite=source.searchParams.getAll('invite');
 if(join.length===1&&!invite.length&&/^[a-f0-9]{64}$/.test(join[0]))target.searchParams.set('join',join[0]);
 else if(invite.length===1&&!join.length&&/^(access:)?[a-f0-9]{64}$/.test(invite[0]))target.searchParams.set('invite',invite[0]);
 location.replace(target.href);
})();
