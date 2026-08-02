const fs=require('fs');
const content=fs.readFileSync('ProfileDetailPage.tsx','utf8');
let inDq=false,inSq=false,inTq=false,inSubst=false,escape=false,depth=0;
for(let i=0;i<content.length;i++){
const ch=content[i];
if(escape){escape=false;continue;}
if(ch===String.fromCharCode(92)){escape=true;continue;}
if(inDq){if(ch===String.fromCharCode(34))inDq=false;continue;}
if(inSq){if(ch===String.fromCharCode(39))inSq=false;continue;}
if(inTq){
if(ch===String.fromCharCode(96)){inTq=false;}
else if(ch===String.fromCharCode(36)&&content[i+1]===String.fromCharCode(123)){inSubst=true;i++;continue;}
else if(ch===String.fromCharCode(125)&&inSubst){inSubst=false;continue;}
continue;}
if(ch===String.fromCharCode(34))inDq=true;
else if(ch===String.fromCharCode(39))inSq=true;
else if(ch===String.fromCharCode(96))inTq=true;
else if(ch===String.fromCharCode(123)&&!inSubst){depth++;}
else if(ch===String.fromCharCode(125)&&!inSubst){depth--;}
}
console.log('Final brace depth:',depth);
