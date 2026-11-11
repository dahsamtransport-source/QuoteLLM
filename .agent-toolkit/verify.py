#!/usr/bin/env python3
"""Static verification of Pharma AI Agent Toolkit repository installation."""
import argparse, json, pathlib, re, sys
def run(root):
    errors=[]
    manifest=root/'.agent-toolkit'/'manifest.json'
    if not manifest.is_file(): return ['missing manifest'],0
    info=json.loads(manifest.read_text(encoding='utf-8'))
    if info.get('toolkit')!='pharma-ai-agent-toolkit': errors.append('wrong toolkit marker')
    paths=info.get('files',[])
    if not isinstance(paths,list) or not paths: errors.append('missing files manifest'); paths=[]
    skill_count=0
    for item in paths:
        rel=pathlib.PurePosixPath(item)
        if rel.is_absolute() or '..' in rel.parts or '.' in rel.parts: errors.append('unsafe path: '+item); continue
        f=root.joinpath(*rel.parts)
        if not f.is_file() or f.is_symlink() or not f.resolve().is_relative_to(root.resolve()):
            errors.append('missing/unsafe: '+item); continue
        if rel.name=='SKILL.md':
            skill_count+=1
            txt=f.read_text(encoding='utf-8')
            expected=rel.parent.name
            if not re.search(r'^---\nname: '+re.escape(expected)+r'\ndescription: .+\n---\n',txt):
                errors.append('invalid skill frontmatter: '+item)
    if skill_count<3: errors.append('expected at least 3 skills')
    print(json.dumps({'status':'FAIL' if errors else 'PASS','project':info.get('profile'),
       'files_checked':len(paths),'skills_checked':skill_count,'errors':errors},ensure_ascii=False,indent=2))
    return errors,skill_count
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',default='.');a=p.parse_args()
    e,n=run(pathlib.Path(a.repo).resolve());sys.exit(1 if e else 0)
