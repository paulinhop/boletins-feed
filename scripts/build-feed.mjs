import {readFileSync,readdirSync,writeFileSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const dir=resolve(process.argv[2]||'.');
const allowed=JSON.parse(readFileSync(join(dir,'publication-allowlist.json'),'utf8'));
const files=readdirSync(dir).filter(f=>/^boletim-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.html$/.test(f)).sort();
if(allowed.version!==1)throw Error('Manifesto de distribuição inválido.');
for(const file of files){
  const html=readFileSync(join(dir,file),'utf8');
  const hash=createHash('sha256').update(html.replace(/\r\n/g,'\n')).digest('hex');
  if(allowed.files[file]!==hash)throw Error(file+': conteúdo não autorizado para distribuição.');
}
const manifest={version:1,updatedAt:new Date().toISOString(),files};
writeFileSync(join(dir,'feed.json.pending'),JSON.stringify(manifest,null,2)+'\n');
renameSync(join(dir,'feed.json.pending'),join(dir,'feed.json'));
console.log(files.length+' edições autorizadas.');
