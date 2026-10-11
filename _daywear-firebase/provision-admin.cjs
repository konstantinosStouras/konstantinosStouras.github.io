// Uses the owner's existing Firebase CLI session; never prints credentials.
const root='C:/Users/LENOVO/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const auth=require(root+'auth.js');const {requireAuth}=require(root+'requireAuth.js');const {Client}=require(root+'apiv2.js');
(async()=>{
 const project=JSON.parse(require('node:fs').readFileSync(__dirname+'/.firebaserc')).projects.default;
 if(project!=='stouras-personal-wardrobe')throw Error('Wrong project');
 await requireAuth({project,...auth.getGlobalDefaultAccount()});
 const c=new Client({urlPrefix:'https://identitytoolkit.googleapis.com',apiVersion:'v1'});
 const base='/projects/'+project+'/accounts:';
 const {body}=await c.post(base+'lookup',{email:['kstouras@gmail.com']});const user=body.users?.[0];
 if(!user||user.localId!=='wqXod8mXlsZr0qCtKSN7A5Fwnl03')throw Error('Owner account does not match existing DayWear model account');
 const claims=JSON.parse(user.customAttributes||'{}');claims.daywearAdmin=true;
 await c.post(base+'update',{localId:user.localId,customAttributes:JSON.stringify(claims)});
 console.log('DayWear owner administrator role configured.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
